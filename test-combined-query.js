const isValidDate = (d) => typeof d === 'string' && /^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(d);
const parseDDMMYYYY = (d) => { const p = d.split(/[\/\-]/); return `${p[2]}-${p[1]}-${p[0]}`; };

let paramCounter = 1;
const queryParams = [];
let whereConditions = ['CURRENT_DATE BETWEEN cr.start_date AND cr.end_date'];

const trainer = "Tay Hoo Wee";
const startDateFrom = "26/03/2026";

if (trainer) {
  whereConditions.push(`(
    EXISTS (
      SELECT 1 FROM course_run_trainer crt 
      WHERE crt.course_run_id = cr.id AND crt.trainer_name ILIKE $${paramCounter}
    ) OR cr.assigned_trainer_name ILIKE $${paramCounter}
  )`);
  queryParams.push(`%${trainer}%`);
  paramCounter++;
}

if (isValidDate(startDateFrom)) {
  whereConditions.push(`cr.start_date >= $${paramCounter}`);
  queryParams.push(parseDDMMYYYY(startDateFrom));
  paramCounter++;
}

const countQuery = `
  SELECT COUNT(*) as total
  FROM course_run cr
  JOIN course c ON cr.course_id = c.id
  WHERE ${whereConditions.join(' AND ')}
`;

console.log("QUERY:", countQuery);
console.log("PARAMS:", queryParams);
