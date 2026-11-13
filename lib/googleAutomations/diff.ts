// Bound the comparison cost for large source files. Insertions do not mark every
// following line as changed; unchanged prefixes/suffixes retain their line numbers.
export function sourceDiff(before: string, after: string) {
  const a=before.split('\n'), b=after.split('\n');
  const removed=new Set<number>(), added=new Set<number>();
  let start=0, endA=a.length, endB=b.length;
  while(start<endA && start<endB && a[start]===b[start])start++;
  while(endA>start && endB>start && a[endA-1]===b[endB-1]){endA--;endB--;}
  const n=endA-start,m=endB-start;
  if(n*m>1000000) {
    for(let i=start;i<endA;i++)removed.add(i);
    for(let j=start;j<endB;j++)added.add(j);
    return {removed,added};
  }
  const rows=Array.from({length:n+1},()=>new Uint32Array(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)rows[i][j]=a[start+i]===b[start+j]?rows[i+1][j+1]+1:Math.max(rows[i+1][j],rows[i][j+1]);
  let i=0,j=0;
  while(i<n || j<m) {
    if(i<n && j<m && a[start+i]===b[start+j]){i++;j++;}
    else if(j<m && (i===n || rows[i][j+1]>=rows[i+1][j]))added.add(start+j++);
    else removed.add(start+i++);
  }
  return {removed,added};
}
