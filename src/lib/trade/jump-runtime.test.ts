import test from 'node:test';
import assert from 'node:assert/strict';
import { JUMP_DEFAULTS, decideJumpEntry, decideJumpExit, summarizeMemory, type JumpMemoryRecord } from './jump-runtime.ts';
const oscillating = Array.from({length:24},(_,i)=>({at:Date.now()-((23-i)*100),price:100+(i%2?.12:0),bid:100+(i%2?.12:0)-.001,ask:100+(i%2?.12:0)+.001}));
test('entry gate blocks stale, unarmed and risk-limited markets',()=>{
 const base={venue:'binance' as const,symbol:'BTCUSDT',ticks:oscillating,config:{...JUMP_DEFAULTS,enabled:true,minScore:1,targetNetUsd:.01},risk:{equity:10000,dayStartEquity:10000,openPositions:[],now:Date.now(),feedFresh:true,armed:true,liveUnlocked:false,isLive:false,venueConnected:true},marketCooldownUntil:0};
 assert.equal(decideJumpEntry({...base,risk:{...base.risk,armed:false}}).ok,false);
 assert.equal(decideJumpEntry({...base,risk:{...base.risk,feedFresh:false}}).ok,false);
 assert.equal(decideJumpEntry({...base,risk:{...base.risk,equity:9700}}).ok,false);
});
test('exit collector uses net pnl after costs and respects stop/time exits',()=>{
 const position={id:'p',venue:'binance' as const,symbol:'BTCUSDT',side:'BUY' as const,qty:1,entry:100,stop:99,openedAt:1000,feesEstimate:.05,slippageEstimate:.02};
 const cfg={...JUMP_DEFAULTS,targetNetUsd:.5};
 assert.equal(decideJumpExit({position,mark:101,now:2000,grossPnl:.7,fees:.1,slippage:.05,config:cfg}).close,true);
 assert.equal(decideJumpExit({position,mark:98,now:2000,grossPnl:-1,fees:.1,slippage:.05,config:cfg}).reason,'Protective stop reached.');
 assert.equal(decideJumpExit({position,mark:100,now:100000, grossPnl:0,fees:0,slippage:0,config:cfg}).reason,'Maximum holding time reached.');
});
test('memory summary reports win rate and net results',()=>{
 const rows:JumpMemoryRecord[]=[{id:'1',venue:'binance',symbol:'BTCUSDT',side:'BUY',score:80,state:'oscillating',spreadPct:.01,entry:100,exit:101,netPnl:1,openedAt:1,closedAt:2,outcome:'win'},{id:'2',venue:'deriv',symbol:'frxEURUSD',side:'SELL',score:70,state:'oscillating',spreadPct:.02,entry:1.1,exit:1.2,netPnl:-.5,openedAt:1,closedAt:2,outcome:'loss'}];
 const s=summarizeMemory(rows); assert.equal(s.winRate,.5); assert.equal(s.netPnl,.5); assert.equal(s.profitFactor,2);
});
