// Dependency-free regression tests. DOM stubs isolate browser APIs; application functions are real.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function app(options = {}) {
  const elements = new Map(), values = new Map(Object.entries(options.stored || {}));
  const element = id => {
    if (!elements.has(id)) elements.set(id, {value:'',textContent:'',innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){},focus(){},addEventListener(){},querySelectorAll(){return []},isConnected:true});
    return elements.get(id);
  };
  const dataPath = fs.existsSync(path.join(root,'data/resources.json')) ? path.join(root,'data/resources.json') : path.join(root,'../review/resource-data.json');
  const metaPath = fs.existsSync(path.join(root,'data/site-meta.json')) ? path.join(root,'data/site-meta.json') : path.join(root,'../review/site-meta.json');
  element('resource-data').textContent = fs.readFileSync(dataPath,'utf8');
  element('site-meta').textContent = fs.readFileSync(metaPath,'utf8');
  const context = vm.createContext({console, URL, URLSearchParams, setTimeout, clearTimeout, Blob, requestAnimationFrame:fn=>fn(),
    location:{href:'https://example.test/',hash:options.hash||'',pathname:'/',search:''},history:{replaceState(){}},
    localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>{if(options.quota)throw Error('quota');values.set(k,v)},removeItem:k=>values.delete(k)},
    document:{getElementById:element,querySelector:s=>element(s.replace(/^#/,'')),querySelectorAll:()=>[],addEventListener(){},body:element('body'),activeElement:null},
    window:{addEventListener(){},matchMedia:()=>({matches:false})},navigator:{},confirm:()=>true});
  const source = process.env.ATLAS_TEST_SOURCE || path.join(root,'src/app.js');
  vm.runInContext(fs.readFileSync(source,'utf8'),context);
  const run = code => vm.runInContext(code,context);
  run('prepareData()');
  return {run,element,values};
}
test('quoted field and negative phrase are individual tokens',()=>{
  const {run}=app();
  const tokens=JSON.parse(run('JSON.stringify(parseQuery(\'author:"Stephen Boyd" -"non convex"\'))'));
  assert.equal(tokens[0].length,2); assert.equal(tokens[0][0].value,'stephen boyd'); assert.equal(tokens[0][1].negative,true);
});
test('OR inside a quoted phrase is literal',()=>{
  assert.equal(app().run('parseQuery(\'"A | B" | Shampoo\').length'),2);
});
test('bad persisted collection shapes never stop startup',()=>{
  const {run}=app({stored:{ora3_favorites:'{}',ora3_selected:'null',ora3_notes:'[]',ora3_status:'"done"'}});
  assert.doesNotThrow(()=>run('loadState()')); assert.equal(run('favorites.size'),0);
});
test('shared URL is independent of the recipients saved filters',()=>{
  const {run}=app({hash:'#?q=Shampoo',stored:{ora3_filter_state:JSON.stringify({category:'discrete',level:'Intro'})}});
  run('loadState()'); assert.equal(run('state.category'),'all');assert.equal(run('state.level'),'all');
});
test('highlight never rewrites entities or generated mark tags',()=>{
  const {run}=app();run('state.q="amp mark"');
  assert.equal(run('highlight("A & B < C")'),'A &amp; B &lt; C');
});
test('unsaved note is retained when detail closes immediately',async()=>{
  const {run,element}=app();run('currentItem=ALL[0]');element('personalNotes').value='A note before close';
  run('savePersonalNote();closeModal("detailModal")');
  await new Promise(resolve=>setTimeout(resolve,360));
  assert.equal(run('notes[ALL[0].id]'),'A note before close');
});
test('quota fallback gives read-your-writes instead of stale persisted value',()=>{
  const {run}=app({quota:true,stored:{probe:'old'}});run('storage.set("probe","new")');
  assert.equal(run('storage.get("probe")'),'new');
});
test('CSV protects formulas after whitespace and quotes CR',()=>{
  const {run}=app(); assert.equal(run('safeCSV("  =1+1")'),"'  =1+1");assert.equal(run('safeCSV("a\\rb")'),'"a\rb"');
});
test('BibTeX separates known author names and has unique stable key',()=>{
  const {run}=app();const bib=run('citationBibTeX(ALL.find(x=>x.id==="c3179514fa7c"))');
  assert.match(bib,/Stephen Boyd and Lieven Vandenberghe/);assert.match(bib,/c3179514fa7c/);
});
test('clear does not resurrect migrated personal data',()=>{
  const {run,values}=app({stored:{ora_favorites_v2:'["c3179514fa7c"]'}});run('loadState();clearPersonalData();loadState()');assert.equal(run('favorites.size'),0);
});
test('all catalog entries render and study paths refer to real records',()=>{
  const {run,element}=app();run('init()');
  assert.equal(element('statTotal').textContent,233);
  assert.equal((element('resourceGrid').innerHTML.match(/class="resource-card"/g)||[]).length,24);
  run('state.activePath="spectral";render()');
  assert.match(element('pathGuide').innerHTML,/Stochastic Lanczos Quadrature/);
  assert.ok(run('filteredItems.some(x=>x.id==="9ce02896f10a")'));
});
test('bad backup is rejected before personal state can be changed',()=>{
  const {run}=app(); run('favorites.add(ALL[0].id)');
  assert.throws(()=>run('validateBackup({schema:"optimization-resource-atlas-user-data",version:1,userData:{}})'));
  assert.throws(()=>run('validateBackup({schema:"optimization-resource-atlas-user-data",version:2,userData:{}})'));
  assert.equal(run('favorites.size'),1);
});
test('backup candidate preserves text and de-duplicates IDs before limiting selection',()=>{
  const {run}=app();
  const result=JSON.parse(run(`JSON.stringify(validateBackup({schema:'optimization-resource-atlas-user-data',version:1,userData:{favorites:[ALL[0].id,'missing'],selected:[ALL[0].id,ALL[0].id,ALL[1].id,ALL[2].id,ALL[3].id],notes:{[ALL[0].id]:'한글\n수식 & <script>'},statuses:{[ALL[0].id]:'reading'},state:{q:'SGD'}}}))`.replace('한글\n','한글\\n')));
  assert.equal(result.selected.length,4); assert.equal(result.favorites.length,1);
  assert.match(Object.values(result.notes)[0],/한글\n수식/); assert.equal(result.state.q,'SGD');
});
test('query filters execute AND, OR, field and negation semantics',()=>{
  const {run}=app();
  assert.ok(run(`queryMatches(ALL.find(x=>x.id==='c3179514fa7c'),'author:"Stephen Boyd" tag:Convex -Shampoo')`));
  assert.ok(run(`queryMatches(ALL.find(x=>x.id==='7d51e93cadaf'),'Adam | Shampoo')`));
  assert.equal(run(`queryMatches(ALL.find(x=>x.id==='7d51e93cadaf'),'Shampoo -Shampoo')`),false);
});
test('empty, relative and active URLs never become external resource links',()=>{
  const {run}=app();
  for(const url of ['', 'javascript:alert(1)','data:text/html,hello','/relative']) assert.equal(run(`validURL(${JSON.stringify(url)})`),'');
});
test('all generated citation keys are unique and script text stays escaped',()=>{
  const {run}=app();
  assert.equal(run('new Set(ALL.map(item=>citationBibTeX(item).split("\\n")[0])).size'),233);
  run('state.q="script amp"');const output=run('highlight("<script>A & B</script>")');
  assert.ok(!output.includes('<script>'));assert.match(output,/&lt;/);
});
test('merge restores four distinct selections when the lists overlap',async()=>{
  const {run,element}=app();element('restoreMode').value='merge';
  run('selected=new Set([ALL[0].id,ALL[1].id])');
  await run(`importBackup({size:100,text:async()=>JSON.stringify({schema:'optimization-resource-atlas-user-data',version:1,userData:{favorites:[],selected:ALL.slice(0,4).map(x=>x.id),notes:{},statuses:{},state:{}}})})`);
  assert.equal(run('selected.size'),4);
});
