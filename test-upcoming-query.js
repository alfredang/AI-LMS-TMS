const isValidDate = (d) => typeof d === 'string' && /^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(d);
const parseDDMMYYYY = (d) => { const p = d.split(/[\/\-]/); return `${p[2]}-${p[1]}-${p[0]}`; };

let upcomingClassesQuery = "SELECT ...";
const params = [];
let paramIndex = 1;
const trainer = "Tay Hoo Wee";
const startDateFrom = "26/03/2026";

if (trainer && trainer !== '') {
  upcomingClassesQuery += ` AND au.full_name ILIKE $${paramIndex}`;
  params.push(`%${trainer}%`);
  paramIndex++;
}

if (isValidDate(startDateFrom)) {
  upcomingClassesQuery += ` AND cr.start_date >= $${paramIndex}`;
  params.push(parseDDMMYYYY(startDateFrom));
  paramIndex++;
}

console.log("UPCOMING QUERY:", upcomingClassesQuery);
console.log("UPCOMING PARAMS:", params);

let countQuery = "SELECT COUNT ...";
const countParams = [];
let countParamIndex = 1;

if (trainer && trainer !== '') {
  countQuery += ` AND au.full_name ILIKE $${countParamIndex}`;
  countParams.push(`%${trainer}%`);
  countParamIndex++;
}

if (isValidDate(startDateFrom)) {
  countQuery += ` AND cr.start_date >= $${countParamIndex}`;
  countParams.push(parseDDMMYYYY(startDateFrom));
  countParamIndex++;
}

console.log("COUNT QUERY:", countQuery);
console.log("COUNT PARAMS:", countParams);

let statsQuery = "SELECT STATS ...";
const statsParams = [...countParams];
let statsParamIndex = 1;

if (trainer && trainer !== '') { statsQuery += ` AND au.full_name ILIKE $${statsParamIndex}`; statsParamIndex++; }
if (isValidDate(startDateFrom)) { statsQuery += ` AND cr.start_date >= $${statsParamIndex}`; statsParamIndex++; }

console.log("STATS QUERY:", statsQuery);
console.log("STATS PARAMS:", statsParams);
