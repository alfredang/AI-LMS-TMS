export function isoDate(value:unknown):string {
 const raw=String(value||'');const s=/^\d{8}$/.test(raw)?`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`:raw.slice(0,10);
 const date=new Date(s+'T00:00:00Z');return !Number.isNaN(+date)&&date.toISOString().slice(0,10)===s?s:'';
}
export function isoTime(value:unknown):string {
 const raw=String(value||'');const s=/^\d{4}$/.test(raw)?`${raw.slice(0,2)}:${raw.slice(2)}`:raw.slice(0,5);
 return /^([01]\d|2[0-3]):[0-5]\d$/.test(s)?s:'';
}
