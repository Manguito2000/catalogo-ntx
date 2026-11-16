const {conciliar,saldoVisible}=require('./conciliar.js');const assert=require('assert');
const T=1e9,d=86400;const c=(id,ab,o={})=>Object.assign({id,fecha:T,abono:ab,bs:false,base:[],estado:'cobrado'},o);
let r;
// 1 sin pagos nuevos
assert.deepEqual(conciliar({pendiente:100,pagos:[]},[c('A',50)],T+d),[]);
// 2 pago exacto
r=conciliar({pendiente:50,pagos:[['p1',50,T+1]]},[c('A',50)],T+d);assert.deepEqual(r,[{id:'A',estado:'confirmado',pagos:[['p1',50]],obs:'Registrado en Holded'}]);
// 3 pago previo (en base) no cuenta
assert.deepEqual(conciliar({pendiente:50,pagos:[['p0',50,T-5]]},[c('A',50,{base:['p0']})],T+d),[]);
// 4 un cobro registrado como dos pagos (efectivo + zelle)
r=conciliar({pendiente:0,pagos:[['p1',30,T+1],['p2',20,T+2]]},[c('A',50)],T+d);assert.deepEqual(r[0].pagos,[['p1',30],['p2',20]]);
// 5 dos cobros, solo se registró el segundo
r=conciliar({pendiente:60,pagos:[['p1',40,T+9]]},[c('A',60),c('B',40,{fecha:T+5})],T+d);assert.equal(r.length,1);assert.equal(r[0].id,'B');
// 6 dos cobros en un solo pago
r=conciliar({pendiente:0,pagos:[['p1',100,T+9]]},[c('A',60),c('B',40,{fecha:T+5})],T+d);assert.deepEqual(r.map(x=>[x.id,x.pagos]),[['A',[['p1',60]]],['B',[['p1',40]]]]);
// 7 montos iguales: confirma el más viejo
r=conciliar({pendiente:50,pagos:[['p1',50,T+9]]},[c('B',50,{fecha:T+5}),c('A',50)],T+d);assert.deepEqual(r.map(x=>x.id),['A']);
// 8 no cuadra -> revisar, nada confirmado
r=conciliar({pendiente:20,pagos:[['p1',80,T+9]]},[c('A',50)],T+d);assert.equal(r[0].estado,'revisar');assert(/80\.00/.test(r[0].obs));
// 8b ya en revisar con la misma obs: sin cambios repetidos
assert.deepEqual(conciliar({pendiente:20,pagos:[['p1',80,T+9]]},[c('A',50,{estado:'revisar',obs:r[0].obs})],T+d),[]);
// 9 Bs: tolerancia 3 % (85 anotado, 83.9 registrado); en divisas no
r=conciliar({pendiente:0,pagos:[['p1',83.9,T+9]]},[c('A',85,{bs:true})],T+d);assert.equal(r[0].estado,'confirmado');assert.deepEqual(r[0].pagos,[['p1',83.9]]);
r=conciliar({pendiente:0,pagos:[['p1',83.9,T+9]]},[c('A',85)],T+d);assert.equal(r[0].estado,'revisar');
// 10 pago ya usado por un cobro confirmado no se reutiliza
r=conciliar({pendiente:50,pagos:[['p1',50,T+1]]},[c('A',50,{estado:'confirmado',pagos:[['p1',50]]}),c('B',50,{fecha:T+2,base:[]})],T+d);assert.deepEqual(r,[]);
// 11 nota saldada sin reconocer / cobro viejo
r=conciliar({pendiente:0,pagos:[['p0',50,T-9]]},[c('A',50,{base:['p0']})],T+d);assert(/saldada/.test(r[0].obs));
r=conciliar({pendiente:50,pagos:[]},[c('A',50)],T+11*d);assert(/11 días/.test(r[0].obs));
// 12 anulado se ignora; revisar que luego cuadra se confirma
assert.deepEqual(conciliar({pendiente:50,pagos:[['p1',50,T+1]]},[c('A',50,{estado:'anulado'})],T+d),[]);
r=conciliar({pendiente:0,pagos:[['p1',50,T+1]]},[c('A',50,{estado:'revisar',obs:'x'})],T+d);assert.equal(r[0].estado,'confirmado');
// 13 pago directo + cobro: 2 pagos, 1 cobro, suma no cuadra -> revisar
r=conciliar({pendiente:0,pagos:[['p1',50,T+1],['p2',30,T+2]]},[c('A',50)],T+d);assert.equal(r[0].estado,'revisar');
// 14 céntimos: 3 cobros de 33.33 en un pago de 100
r=conciliar({pendiente:0,pagos:[['p1',100,T+1]]},[c('A',33.33),c('B',33.33,{fecha:T+1}),c('C',33.33,{fecha:T+2})],T+d);assert.equal(r.length,3);assert.equal(Math.round(r.reduce((s,x)=>s+x.pagos[0][1],0)*100),10000);
assert.deepEqual(saldoVisible(200,[c('A',80),c('B',20,{estado:'confirmado'})]),{porConfirmar:80,saldo:120});
console.log('14 casos OK');
