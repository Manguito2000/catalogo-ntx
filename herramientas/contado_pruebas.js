// Pruebas del descuento de contado: node herramientas/contado_pruebas.js
const { diasHabiles, contadoDecide, contadoMonto, contadoCuadre } = require("./contado.js");
const FER = require("../config.json").feriados;
let ok = 0, mal = 0;
const eq = (nombre, a, b) => { const s = JSON.stringify(a) === JSON.stringify(b); s ? ok++ : mal++; if(!s) console.log("FALLA", nombre, "→", JSON.stringify(a), "esperaba", JSON.stringify(b)); };
const D = (nota, pago, hoy = "2026-12-31") => contadoDecide({ nota, pago, hoy, limite: 4, feriados: FER });

eq("mismo día", diasHabiles("2026-11-23", "2026-11-23", FER), 0);
eq("lun→vie = 4", diasHabiles("2026-11-23", "2026-11-27", FER), 4);
eq("lun→lun siguiente = 5", diasHabiles("2026-11-23", "2026-11-30", FER), 5);
eq("nota en sábado, pago jueves", diasHabiles("2026-11-28", "2026-12-03", FER), 4);
eq("navidad no cuenta (24 y 25)", diasHabiles("2026-12-21", "2026-12-28", FER), 3);
eq("carnaval 2027 no cuenta", diasHabiles("2027-02-05", "2027-02-12", FER), 3);
eq("auto día 4", D("2026-11-23", "2026-11-27"), { dh: 4, pago: "2026-11-27", auto: true });
eq("por aprobar día 5", D("2026-11-23", "2026-11-30"), { dh: 5, pago: "2026-11-30", auto: false });
eq("sin fecha de pago = hoy", D("2026-11-23", "", "2026-11-25"), { dh: 2, pago: "2026-11-25", auto: true });
eq("pago en el futuro = hoy", D("2026-11-23", "2026-12-15", "2026-11-24"), { dh: 1, pago: "2026-11-24", auto: true });
eq("pago antes de la nota = día de la nota", D("2026-11-23", "2026-11-20"), { dh: 0, pago: "2026-11-23", auto: true });
eq("fecha inválida de la nota = por aprobar", contadoDecide({ nota: "", pago: "", hoy: "2026-11-24", limite: 4, feriados: FER }).auto, false);
eq("monto 15 % de 1000", contadoMonto(1000, 15), 150);
eq("monto 15 % de 333,33", contadoMonto(333.33, 15), 50);
eq("cuadre 850 de 1000", contadoCuadre(1000, 850, 1000), 15);
eq("cuadre completo", contadoCuadre(1000, 1000, 1000), 0);
eq("cuadre con abono previo (base 1000, pagó 200, faltan 800, entra 650)", contadoCuadre(800, 650, 1000), 15);
eq("cuadre imposible (>50 %)", contadoCuadre(1000, 300, 1000), null);
console.log(ok + " bien, " + mal + " mal"); if(mal) process.exit(1);
