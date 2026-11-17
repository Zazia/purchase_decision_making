import test from 'node:test';
import assert from 'node:assert/strict';
import {gradeEvidence, recentGroups, validateReviewedSamples, WINDOW_MS} from '../intake/sample-policy.mjs';
import {dimensionsOf,skipReason,runPipeline} from '../intake/run-pipeline.mjs';
import fs from 'node:fs';
const now=Date.parse('2026-11-17T12:00:00Z');
const d={category:'mac-mini',model:'M2_16G_256G_二手',chip:'M2',memoryGb:16,storageGb:256,buyTiming:'used',channel:'闲鱼',useSubsidy:false};
const sample=(i,kind='user_report',price=3000)=>({kind,price,observedAt:now,sourceKey:`source${i}`});
test('五条填报只是低置信候选；三条凭证中置信；单凭证低置信；官方单条高置信',()=>{
 assert.equal(gradeEvidence([0,1,2,3].map(i=>sample(i)),d,now).eligible,false);
 assert.equal(gradeEvidence([0,1,2,3,4].map(i=>sample(i)),d,now).tier,'填报候选（须外部核验）');
 assert.equal(gradeEvidence([sample(1,'verified_paid')],d,now).confidence,'低');
 assert.equal(gradeEvidence([0,1,2].map(i=>sample(i,'verified_paid')),d,now).confidence,'中');
 assert.equal(gradeEvidence([sample(1,'official')],d,now).confidence,'高');
 assert.equal(gradeEvidence([0,1,2,3,4].map(i=>sample(i,'listing')),d,now).eligible,false);
});
test('30天包含边界，未来和超期排除，独立来源不足和离散度拦截',()=>{
 const s=sample(1,'verified_paid');
 assert.equal(gradeEvidence([{...s,observedAt:now-WINDOW_MS}],d,now).eligible,true);
 for(const at of [now+1,now-WINDOW_MS-1])assert.equal(gradeEvidence([{...s,observedAt:at}],d,now).eligible,false);
 assert.equal(gradeEvidence([s,s,s].map(x=>({...x,kind:'user_report'})),d,now).count,1);
 assert.equal(gradeEvidence([1,2,100].map((p,i)=>sample(i,'verified_paid',p)),d,now).eligible,false);
 for(const bad of [{...d,chip:'M4'},{...d,memoryGb:null},{...d,channel:null},{...d,useSubsidy:null}])assert.equal(gradeEvidence([s],bad,now).eligible,false);
 assert.match(gradeEvidence([s],{...d,model:'iPhone 16 pro max_新品',chip:'A19_Pro'},now).reason,/冲突/);
});
const rec=(id,identity,price,at=now)=>({_id:id,anonId:identity,createdAt:at,schemaVersion:2,consentVersion:'share-price-analysis-v1',params:{category:d.category},submittedPlans:[{...d,buyPrice:price,holdingYears:2,source:'custom',sourceId:id,predictedPrice:false,verified:true,kind:'official'}]});
test('用户重复提交取最新；云自称已核验无效；缺失身份不升级',()=>{
 const r=[rec('a','secret',2000,now-1),rec('b','secret',3000),rec('c',null,3100)];
 const groups=recentGroups(r,[],{dimensionsOf,skipReason,now});const g=[...groups.values()][0];
 const grade=gradeEvidence(g.samples,g.dimensions,now);
 assert.equal(grade.count,1);assert.equal(grade.median,3000);assert.equal(grade.kind,'user_report');assert.equal(grade.eligible,false);
});
test('人工证据验证官网域名与价格口径；等级不混合',()=>{
 const row={...sample(1,'official'),region:'CN',currency:'CNY',reviewed:true,evidenceUrl:'https://www.apple.com.cn/shop/buy-mac',dimensions:{...d,buyTiming:'new',channel:'官方'}};
 assert.equal(validateReviewedSamples([row]).length,1);
 for(const change of [{reviewed:false},{currency:'USD'},{region:'HK'},{evidenceUrl:'https://apple.com.cn.evil.test/'},{dimensions:d}])assert.throws(()=>validateReviewedSamples([{...row,...change}]));
 assert.equal(gradeEvidence([sample(1,'verified_paid',2000),...Array.from({length:5},(_,i)=>sample(i,'user_report',9000))],d,now).median,2000);
});
test('重复跑时重算近期分级，过期历史保留且报告台账不存身份',async()=>{
 fs.mkdirSync('scripts/debug/policy-tests',{recursive:true});const dir=fs.mkdtempSync('scripts/debug/policy-tests/run-');
 const files={ledgerFile:dir+'/ledger.json',reportsDir:dir+'/reports',debugDir:dir+'/cache',constantsFile:dir+'/constants.json'};fs.writeFileSync(files.constantsFile,'{"实时市场价快照":{}}');
 const records=Array.from({length:5},(_,i)=>rec('id'+i,'PRIVATE_PERSON_'+i,3000+i));
 const run=at=>runPipeline({files,now:at,fetchRecords:async()=>({envLabel:'test',records})});
 await run(now);let ledger=JSON.parse(fs.readFileSync(files.ledgerFile));assert.equal(Object.values(ledger.groups)[0].grade.eligible,true);
 const result=await run(now+WINDOW_MS+1);ledger=JSON.parse(fs.readFileSync(files.ledgerFile));assert.equal(Object.values(ledger.groups)[0].grade.eligible,false);assert.equal(Object.values(ledger.groups)[0].prices.length,5);
 assert.ok(!fs.readFileSync(files.ledgerFile,'utf8').includes('PRIVATE_PERSON'));assert.ok(!fs.readFileSync(result.reportPath,'utf8').includes('PRIVATE_PERSON'));
 assert.equal(fs.readFileSync(files.constantsFile,'utf8'),'{"实时市场价快照":{}}');
});
