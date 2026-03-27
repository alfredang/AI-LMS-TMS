const isValidDate = (d) => typeof d === 'string' && /^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(d);
const parseDDMMYYYY = (d) => { const p = d.split(/[\/\-]/); return `${p[2]}-${p[1]}-${p[0]}`; };

let paramCounter = 1;
const queryParams = [];
let whereConditions = ['CURRENT_DATE BETWEEN cr.start_date AND cr.end_date'];

const startDateFrom = "26/03/2026";
if (isValidDate(startDateFrom)) {
  whereConditions.push(`cr.start_date >= $${paramCounter}`);
  queryParams.push(parseDDMMYYYY(startDateFrom));
  paramCounter++;
}

console.log("WHERE CLAUSE:", whereConditions.join(' AND '));
console.log("PARAMS:", queryParams);
