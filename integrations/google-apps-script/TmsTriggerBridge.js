/* Google Apps Script V8 template. Not deployed by the localhost review.
 * Preserve existing doGet/doPost handlers: route explicitly instead of replacing
 * them. Set Script Properties TMS_TRIGGER_BRIDGE_SECRET (base64, 32 random bytes),
 * TMS_TRIGGER_BRIDGE_OWNER and TMS_TRIGGER_BRIDGE_HANDLERS (JSON string array).
 * Authorize script.scriptapp and userinfo.email, preserving existing scopes.
 */
function doPost(e) { return tmsTriggerBridgePost_(e); }

function tmsTriggerBridgePost_(e) {
  var props=PropertiesService.getScriptProperties();
  var secret=props.getProperty('TMS_TRIGGER_BRIDGE_SECRET');
  var owner=props.getProperty('TMS_TRIGGER_BRIDGE_OWNER');
  var request,lock;
  function sign(text) {
    return Utilities.computeHmacSha256Signature(Utilities.newBlob(text).getBytes(),Utilities.base64Decode(secret)).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
  }
  function equal(a,b) {if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;var diff=0;for(var i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
  function output(data) {var payload=JSON.stringify(data);return ContentService.createTextOutput(JSON.stringify({payload:payload,signature:sign(payload)})).setMimeType(ContentService.MimeType.JSON);}
  try {
    if(!secret||Utilities.base64Decode(secret).length!==32||!owner||Session.getEffectiveUser().getEmail().toLowerCase()!==owner.toLowerCase())throw Error('owner');
    if(!e||!e.postData||typeof e.postData.contents!=='string'||e.postData.contents.length>16000)throw Error('request');
    var envelope=JSON.parse(e.postData.contents);
    if(typeof envelope.payload!=='string'||!/^[a-f0-9]{64}$/.test(envelope.signature)||!equal(sign(envelope.payload),envelope.signature))throw Error('signature');
    request=JSON.parse(envelope.payload);
    if(request.version!==1||request.scriptId!==ScriptApp.getScriptId()||request.owner!==owner||!Number.isFinite(request.timestamp)||Math.abs(Date.now()-request.timestamp)>90000||!/^[a-f0-9-]{36}$/.test(request.requestId)||['list','change'].indexOf(request.action)<0)throw Error('identity');
    var handlers=JSON.parse(props.getProperty('TMS_TRIGGER_BRIDGE_HANDLERS')||'[]');
    if(!Array.isArray(handlers)||handlers.length>100||handlers.some(function(h){return typeof h!=='string'||!/^[A-Za-z_$][\w$]*$/.test(h);}))throw Error('handlers');
    lock=LockService.getScriptLock();lock.waitLock(10000);
    // Persistent replay records survive process restarts. Expire only old request
    // records; change records remain until an operator reconciles/archives them.
    var now=Date.now(), all=props.getProperties();
    Object.keys(all).filter(function(k){return k.indexOf('TMS_BRIDGE_NONCE_')===0&&Number(all[k])<now-180000;}).forEach(function(k){props.deleteProperty(k);});
    var nonceKey='TMS_BRIDGE_NONCE_'+request.requestId;
    if(props.getProperty(nonceKey))throw Error('replay');
    props.setProperty(nonceKey,String(now));
    var triggerId=null;
    if(request.action==='change') {
      if(handlers.indexOf(request.handler)<0||!/^[a-f0-9-]{36}$/.test(request.changeId))throw Error('handler');
      var settings=request.settings,s=settings&&settings.schedule;
      if(!settings||typeof settings.enabled!=='boolean'||!s)throw Error('settings');
      if(s.kind==='minutes'&&[1,5,10,15,30].indexOf(s.every)>=0&&request.eventType==='CLOCK') {}
      else if(s.kind==='hours'&&[1,2,4,6,8,12].indexOf(s.every)>=0&&request.eventType==='CLOCK') {}
      else if(s.kind==='daily'&&Number.isInteger(s.hour)&&s.hour>=0&&s.hour<24&&typeof s.timezone==='string'&&s.timezone.length<=100&&request.eventType==='CLOCK') {Utilities.formatDate(new Date(),s.timezone,'yyyy');}
      else if(s.kind==='spreadsheetChange'&&request.eventType==='ON_CHANGE'&&(!settings.enabled||typeof request.sourceId==='string'&&/^[A-Za-z0-9_-]{20,200}$/.test(request.sourceId))) {}
      else throw Error('schedule');
      var changeKey='TMS_BRIDGE_CHANGE_'+request.changeId;
      if(props.getProperty(changeKey))throw Error('already attempted');
      var triggers=ScriptApp.getProjectTriggers();
      var matching=triggers.filter(function(t){return t.getHandlerFunction()===request.handler&&String(t.getEventType())===request.eventType;});
      var old=request.liveId?matching.filter(function(t){return t.getUniqueId()===request.liveId;})[0]:null;
      if(request.liveId&&!old||!request.liveId&&matching.length)throw Error('stale');
      if(matching.length>1)throw Error('ambiguous');
      // Save durable intent before mutation. Never automatically repeat an
      // uncertain delete/create; this might otherwise duplicate business runs.
      props.setProperty(changeKey,JSON.stringify({status:'applying',at:now,oldId:request.liveId,settings:settings}));
      if(old)ScriptApp.deleteTrigger(old);
      if(settings.enabled) {
        var builder=ScriptApp.newTrigger(request.handler), created;
        if(s.kind==='spreadsheetChange')created=builder.forSpreadsheet(request.sourceId).onChange().create();
        else {
          var clock=builder.timeBased();
          if(s.kind==='minutes')created=clock.everyMinutes(s.every).create();
          if(s.kind==='hours')created=clock.everyHours(s.every).create();
          if(s.kind==='daily')created=clock.everyDays(1).atHour(s.hour).inTimezone(s.timezone).create();
        }
        triggerId=created.getUniqueId();
        props.setProperty('TMS_BRIDGE_SETTINGS_'+triggerId,JSON.stringify(settings));
      }
      if(old)props.deleteProperty('TMS_BRIDGE_SETTINGS_'+old.getUniqueId());
      props.setProperty(changeKey,JSON.stringify({status:'applied',at:now,triggerId:triggerId,settings:settings}));
    }
    var inventory=ScriptApp.getProjectTriggers().map(function(t){
      var saved=props.getProperty('TMS_BRIDGE_SETTINGS_'+t.getUniqueId());
      return {id:t.getUniqueId(),handler:t.getHandlerFunction(),eventType:String(t.getEventType()),sourceId:t.getTriggerSourceId(),settings:saved?JSON.parse(saved):null};
    });
    return output({ok:true,requestId:request.requestId,scriptId:ScriptApp.getScriptId(),owner:owner,triggers:inventory,triggerId:triggerId});
  }catch(error){
    // Do not return source, exceptions, secrets, tokens or request contents.
    if(request&&secret)return output({ok:false,requestId:request.requestId,scriptId:ScriptApp.getScriptId(),owner:owner,error:'Trigger request rejected or requires reconciliation.'});
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:'Trigger request rejected.'})).setMimeType(ContentService.MimeType.JSON);
  }finally{if(lock&&lock.hasLock())lock.releaseLock();}
}
