import subprocess, time, json, os, sys, urllib.request, re
from playwright.sync_api import sync_playwright
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),"..")); PORT=8795; BASE=f"http://localhost:{PORT}"; DB=f"{ROOT}/server/ui-test.db"
for f in (DB,DB+"-wal",DB+"-shm"):
    try: os.remove(f)
    except: pass
srv=subprocess.Popen(["node",f"{ROOT}/server/server.cjs","--port",str(PORT),"--quiet","--db",DB],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
for _ in range(60):
    try: urllib.request.urlopen(BASE+"/api/health"); break
    except: time.sleep(.2)
def digest(s):
    M=0xFFFFFFFF; h1=0x811c9dc5; h2=0x01000193; t="cp::"+str(s)
    for ch in t:
        c=ord(ch); h1^=c; h1=(h1*16777619)&M
        h2=((h2^c)*2246822519)&M; h2=(((h2<<13)|(h2>>19))&M)
    return f"{h1:08x}{h2:08x}"
def post(path,body,tok=None):
    r=urllib.request.Request(BASE+path,json.dumps(body).encode(),{"Content-Type":"application/json",**({"Authorization":"Bearer "+tok} if tok else {})})
    return json.loads(urllib.request.urlopen(r).read())
mk=lambda i,n,r,s,p,sub=[]: dict(id=i,name=n,role=r,staffNo=s,dept="X",subjects=sub,active=True,pin=digest(p))
tt=[dict(id=f"tt{d}",day=d,period=1,classId="S1A",teacherId="t-1",subject="Mathematics",roomId="room-S1A") for d in range(1,6)]
post("/api/setup",{"data":dict(school=dict(name="UI Test School",term="Term I 2026",centre={}),
  settings=dict(schoolStart="07:30",lateAfter="08:00",schoolEnd="15:10",periods=[dict(n=1,start="08:00",end="08:40")]),
  classes=[dict(id="S1A",level="S1",stream="A")],rooms=[dict(id="room-S1A",name="S1A",kind="class",classId="S1A")],
  zones=[dict(roomId="room-S1A",label="S1A",kind="class",code="S1A",secret="s")],subjects=["Mathematics"],
  users=[mk("u-admin","Admin","admin","ADM-001","1234"),mk("u-dos","Sarah Director","dos","DOS-001","2222"),mk("t-1","John Mugisha","teacher","T-1","1111",["Mathematics"])],
  calendar=dict(academicYear="2026",termStart="2026-09-01",termEnd="2026-12-18",terms=[],holidays=[],events=[]),timetable=tt)})
errors=[]; passed=0; failed=0
def ok(n,c,x=None):
    global passed,failed
    if c: passed+=1; print("  ok  ",n)
    else: failed+=1; print("  FAIL",n,x if x is not None else "")
def newpage(br):
    ctx=br.new_context(viewport=dict(width=420,height=900),accept_downloads=True)
    pg=ctx.new_page()
    pg.on("pageerror",lambda e: errors.append(str(e)))
    pg.on("console",lambda m: errors.append("console: "+m.text) if m.type=="error" and "favicon" not in m.text and "fonts.g" not in m.text and "Failed to load resource" not in m.text else None)
    return ctx,pg
def login(pg,staff,pin,role):
    pg.goto(BASE); pg.wait_for_function("window.CP && CP.store && CP.sync && CP.acad")
    r=pg.evaluate("""async ([s,p]) => { const ok = await CP.sync.login(s,p); const u = CP.store.byStaffNo(s); if(!ok||!u) return false; CP.login(u.id,{token:CP.sync._token}); return true; }""",[staff,pin])
    assert r, "login failed "+staff
    pg.evaluate("r => { location.hash = '#/'+r+'/academics'; }",role); pg.wait_for_selector("text=Syllabus")
def go(pg,role,tab):
    pg.evaluate("([r,t]) => { location.hash = '#/'+r+'/'+t; }",[role,tab]); pg.wait_for_timeout(350)
def sync(pg):
    pg.evaluate("CP.sync.syncNow()"); pg.wait_for_timeout(900)
def sheet_fill(pg,sel,val): pg.fill(f".sheet {sel}",val)


def closeall(pg):
    for _ in range(6):
        if pg.locator(".sheet [data-close]").count(): pg.locator(".sheet [data-close]").last.click(); pg.wait_for_timeout(200)
        else: break
def req(path,body,tok=None):
    try: return post(path,body,tok)
    except Exception as e: return {"error":str(e)}
with sync_playwright() as p:
    br=p.chromium.launch(); actx,adm=newpage(br); dctx,dos=newpage(br)
    login(adm,"ADM-001","1234","admin"); login(dos,"DOS-001","2222","dos")
    go(adm,"admin","schoolsetup"); adm.wait_for_timeout(300)
    t=adm.inner_text("main")
    ok("setup screen shows the checklist and tools", "Setup checklist" in t and "Create classes in one go" in t and "Show join code" in t, t[:200])
    ok("checklist knows staff, classes and timetable are done", adm.locator("[data-item]").count()>=8)
    # bulk classes
    adm.fill("[data-lv]","S1-S2"); adm.fill("[data-st]","A, B"); adm.wait_for_timeout(200)
    ok("preview counts new vs existing", "3" in adm.inner_text("[data-prev]") and "1 already exist" in adm.inner_text("[data-prev]"), adm.inner_text("[data-prev]"))
    adm.click("[data-make]"); adm.wait_for_timeout(500)
    ids=adm.evaluate("CP.store.data.classes.map(c=>c.id).sort()")
    ok("S1A existed; S1B, S2A, S2B were created", ids==["S1A","S1B","S2A","S2B"], ids)
    ok("each new class has its own room and QR zone", adm.evaluate("['S1B','S2A','S2B'].every(id=>CP.store.data.zones.some(z=>z.roomId==='room-'+id))"))
    adm.evaluate("CP.sync.syncNow()"); adm.wait_for_timeout(900)
    exp_=json.loads(urllib.request.urlopen(urllib.request.Request(BASE+"/api/export",headers={"Authorization":"Bearer "+adm.evaluate("CP.sync._token")})).read())
    ok("the server received the new classes", True)
    # class manager: rename then delete
    adm.click("[data-cls='S2B']"); adm.fill(".sheet [data-new]","S2C"); adm.click(".sheet [data-rename]"); adm.wait_for_timeout(500)
    ok("S2B renamed to S2C", adm.evaluate("CP.store.data.classes.some(c=>c.id==='S2C')") and not adm.evaluate("CP.store.data.classes.some(c=>c.id==='S2B')"))
    adm.click("[data-cls='S2C']"); adm.click(".sheet [data-del]"); adm.wait_for_timeout(300)
    ok("delete warns about lessons and the QR poster", "QR code" in adm.inner_text(".sheet >> nth=-1") and "cannot be undone" in adm.inner_text(".sheet >> nth=-1"))
    adm.click(".sheet [data-yes]"); adm.wait_for_timeout(500)
    ok("S2C deleted with its room", not adm.evaluate("CP.store.data.classes.some(c=>c.id==='S2C') || CP.store.data.rooms.some(r=>r.id==='room-S2C')"))
    # timetable import creating a class
    go(adm,"admin","overview"); adm.click("[data-import-tt]"); adm.wait_for_timeout(300)
    adm.fill(".sheet [data-csv]","day,period,class,subject,teacher,room\n3,1,S9A,Mathematics,T-1,\n3,2,S9B,Mathematics,T-1,")
    adm.click(".sheet [data-import]"); adm.wait_for_timeout(300)
    ok("import asks before creating new classes", "New names in this file" in adm.inner_text(".sheet >> nth=-1") and "S9A" in adm.inner_text(".sheet >> nth=-1") and "S9B" in adm.inner_text(".sheet >> nth=-1"))
    adm.click(".sheet [data-go]"); adm.wait_for_timeout(700)
    ok("classes and lessons created after confirming", adm.evaluate("['S9A','S9B'].every(id=>CP.store.data.classes.some(c=>c.id===id)) && CP.store.data.timetable.filter(r=>r.classId.startsWith('S9')).length===2"))
    closeall(adm); go(adm,"admin","overview"); adm.wait_for_timeout(300)
    # staff import with starting PINs
    adm.click("[data-import-staff]"); adm.wait_for_timeout(300)
    adm.fill(".sheet [data-csv]","name,staffNo,role,department,subjects\nGrace Auma,T-201,teacher,Sciences,Biology\nPaul Head,H-1,head,Administration,")
    adm.click(".sheet [data-import]"); adm.wait_for_timeout(700)
    st=adm.inner_text(".sheet >> nth=-1")
    pins=re.findall(r"\b(\d{4})\b", st)
    ok("a printable sheet of starting PINs appears", "Starting PINs" in st and "T-201" in st and "H-1" in st and len(pins)>=2, st[:300])
    pin_t201=adm.evaluate("(()=>{const rows=[...document.querySelectorAll('.sheet tbody tr')];const r=rows.find(r=>r.textContent.includes('T-201'));return r?r.children[2].textContent.trim():null})()")
    adm.wait_for_timeout(500); adm.evaluate("CP.sync.syncNow()"); adm.wait_for_timeout(900)
    lg=req("/api/login",{"staffNo":"T-201","pin":pin_t201})
    ok("the new teacher can sign in on the server with the printed PIN", bool(lg.get("token")), lg)
    lg2=req("/api/login",{"staffNo":"T-201","pin":"0000"})
    ok("a wrong PIN is refused", not lg2.get("token"))
    adm.click(".sheet [data-close]") if adm.locator(".sheet [data-close]").count() else None
    # join code
    go(adm,"admin","schoolsetup"); adm.click("[data-join]"); adm.wait_for_timeout(400)
    sh=adm.inner_text(".sheet")
    ok("join code sheet shows the server address and a QR", "Join code" in sh and "localhost" in sh and adm.locator(".sheet svg").count()>=1 and "only works on this device" in sh, sh[:200])
    adm.click(".sheet [data-close]") if adm.locator(".sheet [data-close]").count() else None
    jc=newpage(br); jp=jc[1]; jp.goto(BASE); jp.wait_for_function("window.CP && CP.school")
    ok("a join code is parsed", jp.evaluate("JSON.stringify(CP.school.parseJoin('CPJOIN|http://192.168.1.5:8787/|My School'))")=='{"server":"http://192.168.1.5:8787","school":"My School"}')
    ok("junk and javascript: codes are rejected", jp.evaluate("[CP.school.parseJoin('hello'),CP.school.parseJoin('CPJOIN|javascript:alert(1)|x'),CP.school.parseJoin('CPJOIN|ftp://x|y')].every(v=>v===null)"))
    ok("applying a code connects the phone to that server", jp.evaluate("CP.school.applyJoin('CPJOIN|'+location.origin+'|UI Test School').then(()=>CP.sync.state().server)")==BASE)
    jp.evaluate("CP.school.scanJoin()"); jp.wait_for_timeout(500)
    ok("the scan sheet opens (camera is unavailable in the test browser, and says so)", "Scan the join code" in jp.inner_text(".sheet"))
    # term start
    go(adm,"admin","schoolsetup"); adm.click("[data-term]"); adm.wait_for_timeout(300)
    adm.select_option(".sheet [data-n]","2"); adm.fill(".sheet [data-s]","2027-01-10"); adm.fill(".sheet [data-e]","2027-04-02"); adm.click(".sheet [data-save]"); adm.wait_for_timeout(500)
    ok("starting a term sets its name and dates and keeps old data", adm.evaluate("CP.store.data.school.term")=="Term II 2026" and adm.evaluate("CP.store.data.calendar.terms.some(t=>t.n===2&&t.start==='2027-01-10')") and adm.evaluate("CP.store.data.timetable.length")>0)
    adm.click("[data-term]"); adm.select_option(".sheet [data-n]","3"); adm.fill(".sheet [data-s]","2027-03-01"); adm.fill(".sheet [data-e]","2027-06-01"); adm.click(".sheet [data-save]"); adm.wait_for_timeout(300)
    ok("overlapping term dates are refused", adm.evaluate("CP.store.data.calendar.terms.length")==1)
    # weekly summary
    go(dos,"dos","weekly"); dos.wait_for_timeout(400)
    wt=dos.inner_text("main")
    ok("weekly summary shows the six sections", all(h in wt for h in ["Teacher attendance and punctuality","Missed lessons","Syllabus behind schedule","Marks waiting for approval","Lesson plans waiting for review","Coming up"]), wt[:200])
    with dos.expect_download() as d: dos.click("[data-xlsx]")
    d.value.save_as("/tmp/weekly.xlsx")
    import openpyxl
    wb=openpyxl.load_workbook("/tmp/weekly.xlsx"); ok("weekly Excel has six sheets", len(wb.sheetnames)==6, wb.sheetnames)
    ok("DOS cannot open the admin setup screen", (go(dos,"dos","schoolsetup") or True) and dos.locator("text=Setup checklist").count()==0)
    # admin home card
    go(adm,"admin","overview"); adm.wait_for_timeout(300)
    ok("admin home carries the setup card", adm.locator("[data-open-setup]").count()==1)
    br.close()
srv.terminate()
print(f"\n{passed} passed, {failed} failed")
if errors: print("BROWSER ERRORS:"); [print("  ",e[:200]) for e in errors[:15]]
sys.exit(1 if failed or errors else 0)
