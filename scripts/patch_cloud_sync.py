import os
import sys

bundle_files = [
    'public/assets/index-DoqMLvwt.js',
    'app/src/main/assets/assets/index-DoqMLvwt.js'
]

patches = [
    (
        "Patch 1: Add User Resilience and Server Sync (kx)",
        "return await ov(K(Z,hx,String(a)),s),s}",
        "try{await ov(K(Z,hx,String(a)),s)}catch(err){console.warn('[Salim] Cloud Firestore user save notice:',err)}try{await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:t,password:r,displayName:n,role:s.role})})}catch(e){}try{let allUsers=await Cx();allUsers.push(s);localStorage.setItem(_x,JSON.stringify(allUsers))}catch(e){}return s}"
    ),
    (
        "Patch 2: Edit User Resilience (Ax)",
        ",await sv(K(Z,hx,String(e)),n)}",
        ";try{await sv(K(Z,hx,String(e)),n)}catch(err){console.warn('[Salim] Cloud Firestore user update notice:',err)}try{let allUsers=await Cx(),target=allUsers.find(x=>x.id===e);if(target){Object.assign(target,n);localStorage.setItem(_x,JSON.stringify(allUsers))}}catch(e){}}"
    ),
    (
        "Patch 3: Delete User Resilience (jx)",
        "await cv(K(Z,hx,String(e)))}",
        "try{await cv(K(Z,hx,String(e)))}catch(err){console.warn('[Salim] Cloud Firestore user delete notice:',err)}try{let allUsers=(await Cx()).filter(x=>x.id!==e);localStorage.setItem(_x,JSON.stringify(allUsers))}catch(e){}}"
    ),
    (
        "Patch 4: Send Private Message Resilience and Server Sync (bw)",
        ",await ov(K(Z,VC,n),o);",
        ";try{await ov(K(Z,VC,n),o)}catch(err){console.warn('[Salim] Cloud Firestore private message notice:',err)}try{fetch('/api/private-messages',{method:'POST',headers:{..._getSamiClientAuthHeaders(),'Content-Type':'application/json'},body:JSON.stringify({id:n,receiverId:rId,text:o.text||'',imageUrl:o.imageUrl||null,audioUrl:o.audioUrl||null,fileUrl:o.fileUrl||null,fileName:o.fileName||null,replyTo:e.replyTo||null,timestamp:t})}).catch(()=>{})}catch(e){};"
    ),
    (
        "Patch 5: Send Channel Message Resilience and Server Sync (aw)",
        ",await ov(K(Z,BC,a),l);",
        ";try{await ov(K(Z,BC,a),l)}catch(err){console.warn('[Salim] Cloud Firestore channel message notice:',err)}try{fetch('/api/channels/'+encodeURIComponent(e.id)+'/messages',{method:'POST',headers:{..._getSamiClientAuthHeaders(),'Content-Type':'application/json'},body:JSON.stringify(l)}).catch(()=>{})}catch(e){};"
    ),
    (
        "Patch 6: Suppress False-Positive Error Banner in Private Chat (gw)",
        'if(readyCount===0&&errCount>=2){let fb=mw(curUid,targetP);if(fb.length>0)t(fb);let msg=(err?.code==="resource-exhausted"||err?.message?.includes("Quota"))?"تم استنفاد الحصة اليومية لقراءة البيانات في السحابة مؤقتاً.":"تعذر استرجاع الرسائل المحفوظة حالياً. يرجى التحقق من اتصال الإنترنت والمحاولة مجدداً.";onStatus?.({loading:!1,error:msg})}',
        'if(readyCount===0&&errCount>=2){let fb=mw(curUid,targetP);if(fb.length>0)t(fb);if(buckets.api.size===0&&fb.length===0){let msg=(err?.code==="resource-exhausted"||err?.message?.includes("Quota"))?"تم استنفاد الحصة اليومية لقراءة البيانات في السحابة مؤقتاً.":"تعذر استرجاع الرسائل المحفوظة حالياً. يرجى التحقق من اتصال الإنترنت والمحاولة مجدداً.";onStatus?.({loading:!1,error:msg})}else{onStatus?.({loading:!1,error:null})}}'
    ),
    (
        "Patch 7: Live Real-Time Polling for Private Messages (gw)",
        "buckets.api=m;emit()}}).catch(()=>{})}return()=>{disposed=!0;unsubs.forEach(u=>{try{u()}catch{}})}}",
        "buckets.api=m;emit()}}).catch(()=>{})}let _pollPm=()=>{if(disposed)return;let qUrl=targetP&&targetP>0?'/api/private-messages?otherUserId='+encodeURIComponent(targetP)+'&limit=120':'/api/private-messages?limit=120';fetch(qUrl,{headers:_getSamiClientAuthHeaders()}).then(r=>r.ok?r.json():null).then(j=>{if(disposed||!Array.isArray(j?.messages))return;let m=new Map;j.messages.forEach(raw=>{let rec=_normPmRecord(raw,raw?.id);rec&&m.set(rec.id,rec)});if(m.size>0||readyCount===0){buckets.api=m;readyCount++;emit();onStatus?.({loading:!1,error:null})}}).catch(()=>{})};_pollPm();let _pmInt=setInterval(_pollPm,3000);unsubs.push(()=>clearInterval(_pmInt));return()=>{disposed=!0;unsubs.forEach(u=>{try{u()}catch{}})}}"
    ),
    (
        "Patch 8: Live Users Sync with Server and Cache (wx)",
        "function wx(e){return Cx(),lv(ld(Z,hx),t=>{if(t.empty)return;let n=[];t.forEach(e=>{n.push(yx(e.data(),Number(e.id)))}),n.sort((e,t)=>e.id-t.id),xx(n),e(n)},()=>{e(bx())})}",
        "function wx(e){let _loadApiUsers=async()=>{try{let res=await fetch('/api/users').then(r=>r.ok?r.json():null);if(res&&Array.isArray(res.users)&&res.users.length>0){let local=bx(),merged=new Map();for(let u of px)merged.set(u.id,{...u});for(let u of local)merged.set(u.id,{...u});for(let u of res.users)merged.set(u.id,{...merged.get(u.id),...u});let arr=Array.from(merged.values()).sort((a,b)=>a.id-b.id);xx(arr);e(arr)}}catch(err){}};_loadApiUsers();let _uInt=setInterval(_loadApiUsers,4000);Cx();let _unsub=lv(ld(Z,hx),t=>{if(t.empty)return;let n=[];t.forEach(e=>{n.push(yx(e.data(),Number(e.id)))}),n.sort((e,t)=>e.id-t.id),xx(n),e(n)},()=>{e(bx())});return ()=>{clearInterval(_uInt);_unsub&&_unsub()}}"
    ),
    (
        "Patch 9: Second Salim Account in px (id: 76, password: 767676)",
        "var px=[{id:1,username:`Salim`,displayName:`القائد Salim`,password:`12345678`,role:`owner`},",
        "var px=[{id:1,username:`Salim`,displayName:`القائد Salim`,password:`12345678`,role:`owner`},{id:76,username:`Salim`,displayName:`Salim`,password:`767676`,role:`owner`,isRestrictedAdmin:!0},"
    ),
    (
        "Patch 10: Multi-account Salim Login in Tx",
        "async function Tx(e,t){let n=e.trim(),r=t.trim();if(!n||!r)return{success:!1,error:`اسم المستخدم أو كلمة المرور غير صحيحة.`};let i=(await Cx()).find(e=>(e.username.trim().toLowerCase()===n.toLowerCase()||(e.id===1&&(n.toLowerCase()===`salim`||n.toLowerCase()===`sami`||n.toLowerCase()===`admin`)))&&e.password===r);if(!i)return{success:!1,error:`اسم المستخدم أو كلمة المرور غير صحيحة.`};let a={id:i.id,username:i.username,displayName:i.displayName,role:vx(i.id,i.username,i.role),avatarUrl:i.avatarUrl||null,verifiedChannels:i.verifiedChannels||{},warningsCount:i.warningsCount||0,loginTimestamp:Date.now()};return Ex(a),{success:!0,user:a}}",
        "async function Tx(e,t){let n=e.trim(),r=t.trim();if(!n||!r)return{success:!1,error:`اسم المستخدم أو كلمة المرور غير صحيحة.`};let i=(await Cx()).find(e=>(e.username.trim().toLowerCase()===n.toLowerCase()||((e.id===1||e.id===76)&&(n.toLowerCase()===`salim`||n.toLowerCase()===`sami`||n.toLowerCase()===`admin`)))&&e.password===r);if(!i)return{success:!1,error:`اسم المستخدم أو كلمة المرور غير صحيحة.`};let a={id:i.id,username:i.username,displayName:i.displayName,role:vx(i.id,i.username,i.role),isRestrictedAdmin:!!(i.isRestrictedAdmin||i.id===76||r===`767676`),avatarUrl:i.avatarUrl||null,verifiedChannels:i.verifiedChannels||{},warningsCount:i.warningsCount||0,loginTimestamp:Date.now()};return Ex(a),{success:!0,user:a}}"
    ),
    (
        "Patch 11: Admin Users Tab Restriction State in hT",
        "hT=({currentUser:e})=>{var $updInit=(0,_.useRef)(!1);let[t,n]=(0,_.useState)(`users`),",
        "hT=({currentUser:e})=>{var $updInit=(0,_.useRef)(!1);let canManageUsers=!(e?.isRestrictedAdmin||e?.id===76||e?.password===`767676`);let[t,n]=(0,_.useState)(canManageUsers?`users`:`channels`),"
    ),
    (
        "Patch 12: Admin Users Tab Button Visibility in hT",
        "(0,$.jsxs)(`button`,{type:`button`,onClick:()=>n(`users`),className:`py-2.5 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition cursor-pointer ${t===`users`?`bg-amber-400 text-slate-950 shadow`:`text-slate-400 hover:text-white`}",
        "canManageUsers&&(0,$.jsxs)(`button`,{type:`button`,onClick:()=>n(`users`),className:`py-2.5 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition cursor-pointer ${t===`users`?`bg-amber-400 text-slate-950 shadow`:`text-slate-400 hover:text-white`}"
    ),
    (
        "Patch 13: Admin Users Panel Render Guard in hT",
        "t===`users`&&(0,$.jsxs)(`div`,{className:`space-y-4`,children:[(0,$.jsxs)(`form`,{onSubmit:He",
        "canManageUsers&&t===`users`&&(0,$.jsxs)(`div`,{className:`space-y-4`,children:[(0,$.jsxs)(`form`,{onSubmit:He"
    ),
    (
        "Patch 14: Channel Creation Resilience and Server Save in ew",
        "async function ew(e){let t=Date.now(),n=`channel_${t}_${Math.random().toString(36).substring(2,7)}`,r=null,i=null;if(e.imageFileOrDataUrl){let t=await Zb(e.imageFileOrDataUrl,`channel_images`,1);r=t.imageUrl,i=t.storagePath}let a=Array.from(new Set([1,...e.memberIds])),o=e.visibility===`hidden`?`hidden`:`visible`,openPub=o!==`hidden`&&!!e.isOpenPublic,pwd=openPub?``:String(e.password||``).trim(),s=e.allowedMemberIds?Array.from(new Set([1,...e.allowedMemberIds])):a,c={id:n,name:e.name.trim(),imageUrl:r,storagePath:i,password:pwd,isOpenPublic:openPub,memberIds:a,visibility:o,allowedMemberIds:s,createdBy:1,createdAt:t,updatedAt:t,displayMemberCount:e.displayMemberCount!==void 0?e.displayMemberCount:null};return await ov(K(Z,zC,n),{id:c.id,name:c.name,imageUrl:c.imageUrl||null,storagePath:c.storagePath||null,password:c.password,isOpenPublic:c.isOpenPublic,memberIds:c.memberIds,visibility:c.visibility,allowedMemberIds:c.allowedMemberIds,createdBy:1,createdAt:t,updatedAt:t,displayMemberCount:c.displayMemberCount}),c}",
        "async function ew(e){let t=Date.now(),n=`channel_${t}_${Math.random().toString(36).substring(2,7)}`,r=null,i=null;if(e.imageFileOrDataUrl){try{let t=await Zb(e.imageFileOrDataUrl,`channel_images`,1);r=t.imageUrl,i=t.storagePath}catch(err){console.warn('Channel img note:',err)}}let a=Array.from(new Set([1,...(e.memberIds||[])])),o=e.visibility===`hidden`?`hidden`:`visible`,openPub=o!==`hidden`&&!!e.isOpenPublic,pwd=openPub?``:String(e.password||``).trim(),s=e.allowedMemberIds?Array.from(new Set([1,...e.allowedMemberIds])):a,c={id:n,name:e.name.trim(),imageUrl:r,storagePath:i,password:pwd,isOpenPublic:openPub,memberIds:a,visibility:o,allowedMemberIds:s,createdBy:1,createdAt:t,updatedAt:t,displayMemberCount:e.displayMemberCount!==void 0?e.displayMemberCount:null};try{if(!_isLocalApkAssetOrigin()){await fetch('/api/channels',{method:'POST',headers:_getSamiClientAuthHeaders(),body:JSON.stringify(c)})}}catch(err){console.warn('Channel server save note:',err)}try{let cur=ZC()||[];cur.push(c);XC(cur)}catch(err){}try{await ov(K(Z,zC,n),{id:c.id,name:c.name,imageUrl:c.imageUrl||null,storagePath:c.storagePath||null,password:c.password,isOpenPublic:c.isOpenPublic,memberIds:c.memberIds,visibility:c.visibility,allowedMemberIds:c.allowedMemberIds,createdBy:1,createdAt:t,updatedAt:t,displayMemberCount:c.displayMemberCount})}catch(err){console.warn('Firestore channel save note:',err)}return c}"
    ),
    (
        "Patch 15: Channel Update Resilience and Server Save in tw",
        "async function tw(e,t){let n={updatedAt:Date.now()};if(t.name!==void 0&&(n.name=t.name.trim()),t.visibility!==void 0&&(n.visibility=t.visibility===`hidden`?`hidden`:`visible`),t.isOpenPublic!==void 0&&(n.isOpenPublic=n.visibility===`hidden`?!1:!!t.isOpenPublic),n.visibility===`hidden`&&(n.isOpenPublic=!1),n.isOpenPublic===!0?(n.password=``):t.password!==void 0&&(n.password=t.password.trim()),t.memberIds!==void 0){let e=Array.from(new Set([1,...t.memberIds]));n.memberIds=e,n.allowedMemberIds=e}if(t.displayMemberCount!==void 0&&(n.displayMemberCount=t.displayMemberCount),t.allowedMemberIds!==void 0&&(n.allowedMemberIds=Array.from(new Set([1,...t.allowedMemberIds]))),t.removeImage)n.imageUrl=null,n.storagePath=null;else if(t.imageFileOrDataUrl){let e=await Zb(t.imageFileOrDataUrl,`channel_images`,1);n.imageUrl=e.imageUrl,n.storagePath=e.storagePath}await sv(K(Z,zC,e),n)}",
        "async function tw(e,t){let n={updatedAt:Date.now()};if(t.name!==void 0&&(n.name=t.name.trim()),t.visibility!==void 0&&(n.visibility=t.visibility===`hidden`?`hidden`:`visible`),t.isOpenPublic!==void 0&&(n.isOpenPublic=n.visibility===`hidden`?!1:!!t.isOpenPublic),n.visibility===`hidden`&&(n.isOpenPublic=!1),n.isOpenPublic===!0?(n.password=``):t.password!==void 0&&(n.password=t.password.trim()),t.memberIds!==void 0){let e=Array.from(new Set([1,...t.memberIds]));n.memberIds=e,n.allowedMemberIds=e}if(t.displayMemberCount!==void 0&&(n.displayMemberCount=t.displayMemberCount),t.allowedMemberIds!==void 0&&(n.allowedMemberIds=Array.from(new Set([1,...t.allowedMemberIds]))),t.removeImage)n.imageUrl=null,n.storagePath=null;else if(t.imageFileOrDataUrl){try{let e=await Zb(t.imageFileOrDataUrl,`channel_images`,1);n.imageUrl=e.imageUrl,n.storagePath=e.storagePath}catch(err){}}try{if(!_isLocalApkAssetOrigin()){await fetch('/api/channels/'+encodeURIComponent(e),{method:'PUT',headers:_getSamiClientAuthHeaders(),body:JSON.stringify(n)})}}catch(err){}try{let cur=ZC()||[],idx=cur.findIndex(x=>x.id===e);if(idx!==-1){Object.assign(cur[idx],n);XC(cur)}}catch(err){}try{await sv(K(Z,zC,e),n)}catch(err){console.warn('Firestore updateDoc note:',err)}return n}"
    ),
    (
        "Patch 16: Channel Delete Resilience and Server Save in nw",
        "async function nw(e){await cv(K(Z,zC,e.id)),(e.imageUrl||e.storagePath)&&await $b(e.imageUrl,e.storagePath)}",
        "async function nw(e){let cid=typeof e===`object`&&e?e.id:String(e);try{if(!_isLocalApkAssetOrigin()){await fetch('/api/channels/'+encodeURIComponent(cid),{method:'DELETE',headers:_getSamiClientAuthHeaders()})}}catch(err){}try{let cur=ZC()||[];XC(cur.filter(x=>x.id!==cid))}catch(err){}try{await cv(K(Z,zC,cid)),(e.imageUrl||e.storagePath)&&await $b(e.imageUrl,e.storagePath)}catch(err){console.warn('Firestore deleteDoc note:',err)}return !0}"
    ),
    (
        "Patch 17: Live Channels Sync with Server in $C",
        "function $C(e,t){let n=ZC(t);return n.length>0&&e(n),JC(),lv(ld(Z,zC),n=>{",
        "function $C(e,t){let n=ZC(t);n.length>0&&e(n);JC();try{if(!_isLocalApkAssetOrigin()){fetch('/api/channels',{headers:_getSamiClientAuthHeaders()}).then(r=>r.ok?r.json():null).then(d=>{if(d&&Array.isArray(d.channels)&&d.channels.length>0){let chs=d.channels.map(c=>({id:String(c.id),name:String(c.name||'قناة تداول'),imageUrl:c.imageUrl||null,storagePath:c.storagePath||null,password:c.isOpenPublic?'':String(c.password||''),isOpenPublic:!!c.isOpenPublic,memberIds:Array.isArray(c.memberIds)?c.memberIds:[1],visibility:c.visibility==='hidden'?'hidden':'visible',allowedMemberIds:Array.isArray(c.allowedMemberIds)?c.allowedMemberIds:[1],createdBy:Number(c.createdBy||1),createdAt:Number(c.createdAt||Date.now()),updatedAt:Number(c.updatedAt||Date.now()),displayMemberCount:c.displayMemberCount!=null?Number(c.displayMemberCount):null}));XC(chs);let filtered=chs.filter(ch=>!t||t===1||ch.visibility!=='hidden'||ch.allowedMemberIds.includes(t));e(filtered)}}).catch(()=>{})}}catch(err){}return lv(ld(Z,zC),n=>{"
    )
]

for bundle_path in bundle_files:
    if not os.path.exists(bundle_path):
        print(f"Skipping {bundle_path} (does not exist)")
        continue

    print(f"Processing {bundle_path}...")
    with open(bundle_path, 'r', encoding='utf-8') as f:
        code = f.read()

    applied_count = 0
    for name, old_str, new_str in patches:
        if old_str in code:
            code = code.replace(old_str, new_str, 1)
            print(f"  ✓ {name} applied successfully")
            applied_count += 1
        else:
            print(f"  - {name} target already patched or not found")

    with open(bundle_path, 'w', encoding='utf-8') as f:
        f.write(code)
    print(f"Completed {bundle_path} with {applied_count} patches applied.\n")

print("All cloud sync patches completed.")
