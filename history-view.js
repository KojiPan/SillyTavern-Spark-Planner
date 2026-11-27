export const hasHistorySnapshot=record=>Array.isArray(record.generation?.items) && Array.isArray(record.generation?.selected?.reasoning) && Array.isArray(record.generation?.selected?.spark);
export function historySummary(record,chat=[]){
    const plan=record.applied || record.plan;
    const index=record.generation?.reply?.index;
    // Stable turn IDs take precedence; reply indices alone can drift after chat edits.
    const user=chat.find(m=>m.is_user && record.turn && m.extra?.spark_planner===record.turn);
    const input=plan?.input ?? user?.mes;
    const compact=value=>String(value || '').replace(/\s+/g,' ').trim();
    const summary=compact(input) || compact(record.name) || (plan?.standalone?'仅规划':compact(record.generation?.discovery ?? plan?.discovery)) || '仅规划';
    const date=new Date(record.time),valid=Number.isFinite(date.getTime());
    return {
        title:Number.isInteger(index)?`回复 ${index+1}`:record.name || '规划记录',
        summary:Array.from(summary).slice(0,56).join('')+(Array.from(summary).length>56?'…':''),
        day:valid?date.toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'}):'日期未记录',
        time:valid?date.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'时间未记录',
        dayKey:valid?`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`:'unknown',
    };
}
