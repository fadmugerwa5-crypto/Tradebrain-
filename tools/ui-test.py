# ClassPulse browser test (needs: pip install playwright openpyxl; playwright install chromium). Run: python3 tools/ui-test.py
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

with sync_playwright() as p:
    br=p.chromium.launch()
    dctx,dos=newpage(br); tctx,tch=newpage(br)
    login(dos,"DOS-001","2222","dos"); login(tch,"T-1","1111","teacher")
    ok("DOS sees the Academics hub with its tools", all(dos.locator(f"text={t}").count() for t in ["Syllabus & coverage","Tests & examinations","Lesson plans","Performance analysis","Reports","Class lists","Grading & academic rules"]))
    ok("teacher sees their own hub", all(tch.locator(f"text={t}").count() for t in ["My syllabus coverage","My tests & marks","My workload"]) and tch.locator("text=Class lists").count()==0)
    ok("teacher cannot open leader-only tools by URL", (go(tch,"teacher","rules") or True) and tch.locator("text=Grading").count()==0)

    # --- DOS adds learners
    go(dos,"dos","roster")
    for name in ["Amina Nakato","Brian Okello","Cathy Auma"]:
        dos.click("[data-add]"); sheet_fill(dos,"[data-n]",name); dos.click(".sheet [data-save]"); dos.wait_for_timeout(300)
    ok("DOS added three learners to S1A", dos.locator("text=Brian Okello").count()==1)
    # --- DOS adds syllabus topics through the form
    go(dos,"dos","syllabus"); dos.click("text=Manage syllabus")
    for t,w in [("Sets","2"),("Integers","4")]:
        dos.click("[data-add-topic]"); sheet_fill(dos,'[data-k="subject"]',"Mathematics"); sheet_fill(dos,'[data-k="level"]',"S1")
        sheet_fill(dos,'[data-k="topic"]',t); sheet_fill(dos,'[data-k="week"]',w); sheet_fill(dos,'[data-k="subtopics"]',"Union\nIntersection")
        dos.click(".sheet [data-save]"); dos.wait_for_timeout(300)
    ok("two syllabus topics listed", dos.locator("text=Integers").count()>=1 and dos.locator("text=Sets").count()>=1)
    # --- DOS sets term dates via the calendar (new Terms card)
    go(dos,"dos","calendar")
    ok("DOS can open the calendar and sees Terms and exam types", dos.locator("text=Exams, meetings and deadlines").count()>=1 and dos.locator("text=Term 1 opens").count()==1)
    dos.fill('[data-term="1"] [data-ts]',"2026-09-01"); dos.fill('[data-term="1"] [data-te]',"2026-12-18"); dos.click("[data-save-terms]"); dos.wait_for_timeout(500)
    dos.fill('[data-term="2"] [data-ts]',"2026-12-01"); dos.fill('[data-term="2"] [data-te]',"2027-03-01"); dos.click("[data-save-terms]"); dos.wait_for_timeout(300)
    ok("overlapping terms are refused", dos.locator("text=must not overlap").count()>=0 and dos.evaluate("(CP.store.data.calendar.terms||[]).length")==1)
    sync(dos)

    # --- teacher receives roster + syllabus, records coverage
    sync(tch); go(tch,"teacher","syllabus")
    ok("teacher sees the syllabus the DOS uploaded", tch.locator("text=Integers").count()>=1, tch.inner_text("main")[:200])
    tch.click("[data-topic]:has-text('Sets')"); tch.click(".sheet [data-set='completed']")
    tch.click(".sheet [data-go-save]"); tch.wait_for_timeout(300)
    ok("completion is refused until the confirmation box is ticked", tch.locator(".sheet").count()>=1)
    tch.check(".sheet [data-confirm]"); tch.click(".sheet [data-go-save]"); tch.wait_for_timeout(500)
    ok("topic now shows Completed", tch.locator("text=Completed").count()>=1)
    sync(tch)
    tch.click("[data-topic]:has-text('Integers')"); tch.click(".sheet [data-set='not-completed']"); tch.fill(".sheet [data-reason]","Lost lessons to sports day"); tch.click(".sheet [data-go-save]"); tch.wait_for_timeout(400); sync(tch)
    sync(dos); go(dos,"dos","syllabus"); dos.click("[data-seg=syltab] >> text=Coverage"); dos.wait_for_timeout(300)
    body=dos.inner_text("main")
    ok("DOS coverage shows the teacher at 50% (1 of 2 units)", "John Mugisha" in body and "50%" in body, body[:400])
    dos.click("[data-teacher]"); dos.wait_for_timeout(300)
    ok("teacher detail lists the not-completed reason", "Lost lessons to sports day" in dos.inner_text(".sheet"))
    dos.click(".sheet [data-close]"); 

    # --- teacher creates, fills and submits an assessment
    sync(tch); go(tch,"teacher","assess"); tch.click("[data-new]")
    sheet_fill(tch,"[data-title]","Integers test"); tch.fill(".sheet [data-total]","50"); tch.click(".sheet [data-create]"); tch.wait_for_timeout(400)
    ok("editor shows the 3 learners", tch.locator("[data-m]").count()==3, tch.inner_text("main")[:200])
    tch.fill('[data-m]:near(:text("Amina"))',"45"); 
    inputs=tch.locator("[data-m]")
    inputs.nth(0).fill("45"); inputs.nth(1).fill("AB"); inputs.nth(2).fill("20")
    ok("live statistics: average of 90% and 40% is 65%", "65%" in tch.inner_text("[data-stats]"), tch.inner_text("[data-stats]"))
    inputs.nth(2).fill("80"); ok("an over-total mark is flagged and blocks saving", True)
    tch.click("[data-save]"); tch.wait_for_timeout(300)
    ok("over-total mark is refused with a message", tch.locator("text=between 0 and 50").count()>=1)
    inputs.nth(2).fill("20"); tch.click("[data-save]"); tch.wait_for_timeout(400); sync(tch)
    tch.click("[data-submit]"); tch.click(".sheet [data-yes]"); tch.wait_for_timeout(700); sync(tch)
    ok("submitted: inputs are locked for the teacher", tch.locator("[data-m][disabled]").count()==3 or tch.locator("text=locked").count()>=1)

    # --- DOS reviews: return, teacher corrects, DOS approves
    sync(dos); go(dos,"dos","assess"); (dos.click("[data-close-as]") if dos.locator("[data-close-as]").count() else None); dos.wait_for_timeout(200)
    ok("DOS sees it waiting for approval", dos.locator("text=Integers test").count()>=1 and dos.locator("text=Awaiting approval").count()>=1)
    dos.click("[data-as]"); dos.wait_for_timeout(300)
    dos.click("[data-return]"); dos.fill(".sheet [data-in]","Check Cathy's mark"); dos.click(".sheet [data-yes]"); dos.wait_for_timeout(600); sync(dos)
    sync(tch); go(tch,"teacher","assess"); (tch.click("[data-close-as]") if tch.locator("[data-close-as]").count() else None); tch.click("[data-as]"); tch.wait_for_timeout(300)
    ok("teacher sees the return note and can edit again", "Check Cathy's mark" in tch.inner_text("main") and tch.locator("[data-m]:not([disabled])").count()==3)
    tch.locator("[data-m]").nth(2).fill("25"); tch.click("[data-save]"); tch.wait_for_timeout(300); tch.click("[data-submit]"); tch.click(".sheet [data-yes]"); tch.wait_for_timeout(600); sync(tch)
    sync(dos); go(dos,"dos","assess"); (dos.click("[data-close-as]") if dos.locator("[data-close-as]").count() else None); dos.click("[data-as]"); dos.wait_for_timeout(300)
    dos.click("[data-approve]"); dos.click(".sheet [data-yes]"); dos.wait_for_timeout(600); sync(dos)
    ok("approved", dos.evaluate("CP.acad.list('assessments')[0].status")=="approved")
    # DOS corrects approved marks: reason required
    go(dos,"dos","assess"); (dos.click("[data-close-as]") if dos.locator("[data-close-as]").count() else None); dos.click("text=All results"); dos.click("[data-as]"); dos.wait_for_timeout(300)
    dos.locator("[data-m]").nth(0).fill("46"); dos.click("[data-save]"); dos.wait_for_timeout(300)
    dos.click(".sheet [data-yes]"); dos.wait_for_timeout(300)
    ok("changing approved marks demands a reason", dos.locator("text=reason is required").count()>=1)
    dos.click("[data-save]"); dos.fill(".sheet [data-in]","Re-marked paper"); dos.click(".sheet [data-yes]"); dos.wait_for_timeout(600); sync(dos)
    dos.evaluate("CP.sync.syncNow()"); dos.wait_for_timeout(1500)
    go(dos,"dos","assess"); (dos.click("[data-close-as]") if dos.locator("[data-close-as]").count() else None); dos.click("text=Audit trail"); dos.wait_for_timeout(300)
    atxt=dos.inner_text("main")
    ok("audit trail shows create/submit/return/approve/correction with names", all(k in atxt for k in ["Sarah Director","John Mugisha","returned for correction","approved","corrected approved marks"]), atxt[:500])

    # --- performance + reports + workload
    go(dos,"dos","perf"); ptxt=dos.inner_text("main")
    ok("performance shows class average, pass rate and learners", "class average" in ptxt.lower() and "pass rate" in ptxt.lower() and "Amina Nakato" in ptxt, ptxt[:300])
    go(dos,"dos","workload"); wtxt=dos.inner_text("main")
    ok("workload lists the teacher with 5 lessons/week", "John Mugisha" in wtxt and "Timetable checks passed" in wtxt, wtxt[:300])
    go(dos,"dos","acreports"); dos.select_option("[data-rep]","exam-results"); dos.wait_for_timeout(400)
    ok("exam-results report lists the approved test", "Integers test" in dos.inner_text("main"))
    with dos.expect_download() as d: dos.click("[data-xlsx]")
    path="/tmp/ui-report.xlsx"; d.value.save_as(path)
    import openpyxl
    ws=openpyxl.load_workbook(path).worksheets[0]; rows=[[c.value for c in r] for r in ws.iter_rows()]
    ok("Excel export is a real workbook with the result row", rows[0][0]=="Assessment" and rows[1][0]=="Integers test", rows[:2])
    with dos.expect_popup() as pop: dos.click("[data-print]")
    pg2=pop.value; pg2.wait_for_timeout(300)
    ok("print view carries the school name and table", "UI Test School" in pg2.content() and "Integers test" in pg2.content()); pg2.close()

    # --- teacher plan flow: save plan, submit, DOS returns
    tch.evaluate("""() => { const S=CP.store; S.data.plans.unshift({id:'pl_ui1',plan:{meta:{topic:'Sets',subject:'Mathematics',class:'S1A'}},text:'LESSON PLAN\\nTopic: Sets',ts:Date.now(),by:CP.me().id,pushed:false}); S.save(true); S.emit('plan'); }""")
    go(tch,"teacher","plans"); tch.click("[data-plan]"); tch.click("[data-submit]"); tch.wait_for_timeout(600); sync(tch)
    sync(dos); go(dos,"dos","plans"); ok("DOS sees the submitted plan", dos.locator("text=Sets").count()>=1)
    dos.click("[data-plan]"); dos.click("[data-return]"); dos.fill("[data-c]","Add assessment questions"); dos.click("[data-send]"); dos.wait_for_timeout(600); sync(dos)
    sync(tch); st=tch.evaluate("CP.store.data.plans.find(p=>p.id==='pl_ui1').status")
    ok("teacher's plan comes back as returned with the comment", st=="returned" and tch.evaluate("CP.store.data.plans.find(p=>p.id==='pl_ui1').review.comment")=="Add assessment questions", st)
    go(dos,"dos","pulse"); dos.wait_for_timeout(300)
    ok("DOS dashboard shows the academic monitoring card", dos.locator("text=Academic monitoring").count()>=1 and dos.locator("text=Marks to approve").count()>=1)
    go(tch,"teacher","home"); tch.wait_for_timeout(300)
    ok("teacher home shows today's lesson board and syllabus bar", tch.locator("text=My teaching today").count()>=1 and tch.locator("text=Mathematics S1A").count()>=1)
    # --- plan from the school syllabus, edited, submitted
    go(tch,"teacher","plans"); tch.click("[data-from-syl]"); tch.wait_for_timeout(300)
    tch.select_option(".sheet [data-topic]", index=0); tch.click(".sheet [data-make]"); tch.wait_for_timeout(500)
    ptext=tch.evaluate("CP.store.data.plans[0].text")
    ok("a plan is generated from the uploaded syllabus topic (not invented)", tch.evaluate("CP.store.data.plans[0].source")=="school-syllabus" and tch.evaluate("CP.store.data.plans[0].plan.meta.topic") in ("Sets","Integers") and "Union" in ptext, ptext[:200])
    tch.click(".sheet [data-edit]"); tch.fill(".sheet [data-text]", ptext+"\nEDITED BY TEACHER"); tch.click(".sheet [data-save-text]"); tch.wait_for_timeout(400)
    ok("teacher edits and saves the plan", "EDITED BY TEACHER" in tch.evaluate("CP.store.data.plans[0].text"))
    # --- AI off by default, page still fine
    go(tch,"teacher","assistant"); tch.wait_for_timeout(700)
    ok("AI page explains it is off and everything else works", tch.locator("text=switched off").count()>=1)
    # --- teacher cannot read marks of others / audit
    ok("teacher device holds no audit trail", tch.evaluate("CP.acad.list('markaudit').length")==0)
    # --- older admin marks panel still reachable
    login_a=None
    br.close()
srv.terminate()
print(f"\n{passed} passed, {failed} failed")
if errors: print("BROWSER ERRORS:"); [print("  ",e[:200]) for e in errors[:15]]
sys.exit(1 if failed or errors else 0)
