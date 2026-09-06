/** Class dates are Singapore wall-clock times. No device timezone dependency. */
export function classStart(day: string | null, time: string | null): Date | null {
 if(!day || !time)return null;
 const d=day.includes('-')?day.slice(0,10):day.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
 const t=(time||'0900').replace(':','');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!/^\d{4}$/.test(t))return null;
 const date=new Date(`${d}T${t.slice(0,2)}:${t.slice(2,4)}:00+08:00`);
 return Number.isNaN(date.getTime())?null:date;
}
export function dueReminderDays(start:Date, now:Date):number[] {
 // One-hour retry window; never deliver a missed three-day reminder one day before class.
 return [3,1].filter(days=>{const due=start.getTime()-days*86400000;return now.getTime()>=due&&now.getTime()<due+3600000;});
}
