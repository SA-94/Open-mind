// نقطة البداية للتطبيق
const app = document.getElementById('app');

// ترميز/فك ترميز آمن للنص داخل الرابط
function encodePayload(obj) {
    try { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); } catch(e) { return ''; }
}
function decodePayload(str) {
    try { return JSON.parse(decodeURIComponent(escape(atob(str)))); } catch(e) { return null; }
}
// دالة مساعدة لبناء رابط الطالب متوافقة مع file:// و http(s)، مع تضمين بيانات الجلسة
function getStudentUrl(phone, idx) {
    const base = location.href.split('?')[0].split('#')[0];
    const teacher = JSON.parse(localStorage.getItem('teacher_' + phone) || 'null');
    const sessionData = teacher && teacher.sessions ? teacher.sessions[idx] : null;
    const binId = getSessionBinId(phone, idx);
    // نضمّن snapshot للعمل المحلي + binId للمزامنة الفورية
    const payload = (teacher && sessionData) ? encodePayload({ teacher: { name: teacher.name, phone: teacher.phone }, sessionIdx: idx, session: sessionData }) : '';
    const sep = base.includes('?') ? '&' : '?';
    const dataPart = payload ? `&data=${payload}` : '';
    const binPart = binId ? `&bin=${binId}` : '';
    return `${base}${sep}session=${phone}_${idx}${dataPart}${binPart}`;
}

// --- تكامل مع JSONBin.io للمزامنة الفورية (مجاني تماماً) ---
// احصل على API key مجاني من https://jsonbin.io (اختياري، يعمل بدونه لكن محدود)
const JSONBIN_API_KEY = '$2a$10$u60d0G.BqvU7IAmt8xch.udS5Z4lIe9PtSy4khmtd.0MqHkRzDFyK'; // X-MASTER-KEY من حسابك
const JSONBIN_BASE = 'https://api.jsonbin.io/v3';
let _binCache = {}; // cache لـ bin IDs

function getSessionBinId(phone, idx) {
    const key = `bin_${phone}_${idx}`;
    return localStorage.getItem(key) || null;
}
function setSessionBinId(phone, idx, binId) {
    localStorage.setItem(`bin_${phone}_${idx}`, binId);
}

function writeSessionState(phone, idx, state, callback) {
    const binId = getSessionBinId(phone, idx);
    const headers = { 'Content-Type': 'application/json' };
    if (JSONBIN_API_KEY) headers['X-Master-Key'] = JSONBIN_API_KEY;
    
    const data = { phone, idx, ...state, updatedAt: Date.now() };
    console.log('📤 كتابة حالة الجلسة:', { binId, state });
    
    if (binId) {
        // تحديث bin موجود
        fetch(`${JSONBIN_BASE}/b/${binId}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(data)
        })
        .then(r => {
            console.log('✅ تم تحديث JSONBin:', r.ok);
            return r.ok ? callback && callback(true) : callback && callback(false);
        })
        .catch(err => {
            console.error('❌ خطأ في تحديث JSONBin:', err);
            callback && callback(false);
        });
    } else {
        // إنشاء bin جديد
        console.log('🆕 إنشاء bin جديد...');
        fetch(`${JSONBIN_BASE}/b`, {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        })
        .then(r => r.json())
        .then(json => {
            console.log('📦 JSONBin تم الإنشاء:', json);
            if (json.metadata && json.metadata.id) {
                setSessionBinId(phone, idx, json.metadata.id);
                console.log('💾 Bin ID حُفظ:', json.metadata.id);
                callback && callback(true);
            } else {
                console.error('❌ فشل إنشاء bin');
                callback && callback(false);
            }
        })
        .catch(err => {
            console.error('❌ خطأ في إنشاء JSONBin:', err);
            callback && callback(false);
        });
    }
}

function readSessionState(phone, idx, callback) {
    const binId = getSessionBinId(phone, idx);
    if (!binId) {
        console.warn('⚠️ لا يوجد binId للقراءة');
        return callback && callback(null);
    }
    
    const headers = {};
    if (JSONBIN_API_KEY) headers['X-Master-Key'] = JSONBIN_API_KEY;
    
    fetch(`${JSONBIN_BASE}/b/${binId}/latest`, { headers })
        .then(r => {
            if (!r.ok) {
                console.error('❌ فشل قراءة JSONBin:', r.status);
                return null;
            }
            return r.json();
        })
        .then(json => {
            if (json && json.record) {
                console.log('📥 تم قراءة الحالة:', json.record);
            }
            callback && callback(json && json.record ? json.record : null);
        })
        .catch(err => {
            console.error('❌ خطأ في قراءة JSONBin:', err);
            callback && callback(null);
        });
}

// تحميل موحد لمكتبة QR مع طابور انتظار للـ callbacks لمنع التحميل المتكرر
function ensureQRCodeLib(cb) {
    if (window.QRCode) return cb(true);
    if (!window._qrcodeLoader) {
        window._qrcodeLoader = [];
        window._qrcodeLoader.push(cb);
        const script = document.createElement('script');
        // تحميل من CDN (موثوق) — إذا أردت نسخة محلية كاملة، سأضعها هنا
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
        script.onload = () => {
            // notify queued callbacks
            const q = window._qrcodeLoader || [];
            window._qrcodeLoader = null;
            q.forEach(fn => { try { fn(!!window.QRCode); } catch(e){ console.error(e); } });
        };
        script.onerror = () => {
            // فشل تحميل الملف المحلي — نخبر المتصلين بالفشل
            const q = window._qrcodeLoader || [];
            window._qrcodeLoader = null;
            q.forEach(fn => { try { fn(false); } catch(e){ console.error(e); } });
        };
        document.head.appendChild(script);
    } else {
        // already loading, just queue
        window._qrcodeLoader.push(cb);
    }
}
function renderLogin() {
    app.innerHTML = `
        <div class="title">منصة اختبار الطلاب</div>
        <div class="subtitle">إدارة الاختبار، توليد الباركود، ومتابعة نتائج الطلاب في مكان واحد.</div>
        <label>رقم الجوال</label>
        <input type="text" id="phone" placeholder="أدخل رقم الجوال">
        <div class="button-row" style="justify-content:center; margin-top:8px;">
            <button id="loginBtn">تسجيل الدخول</button>
        </div>
        <div class="subtitle" style="margin-top:10px;">
            دكتور جديد؟ <a href="#" id="newTeacher">إنشاء حساب دكتور</a>
        </div>
    `;
    document.getElementById('loginBtn').onclick = handleLogin;
    document.getElementById('newTeacher').onclick = renderNewTeacher;
}

function renderNewTeacher() {
    app.innerHTML = `
        <div class="title">تسجيل دكتور جديد</div>
        <div class="subtitle">أنشئ حسابك لتبدأ بإنشاء الاختبارات ومشاركة الروابط مع الطلاب.</div>
        <label>اسم الدكتور</label>
        <input type="text" id="teacherName" placeholder="أدخل اسمك">
        <label>رقم الجوال</label>
        <input type="text" id="teacherPhone" placeholder="أدخل رقم الجوال">
        <div class="button-row" style="margin-top:12px;">
            <button id="createTeacherBtn" class="btn-success">إنشاء الحساب</button>
            <button id="backBtn" class="btn-secondary">رجوع</button>
        </div>
    `;
    document.getElementById('createTeacherBtn').onclick = handleCreateTeacher;
    document.getElementById('backBtn').onclick = renderLogin;
}

function handleLogin() {
    const phone = document.getElementById('phone').value.trim();
    if (!phone) return alert('يرجى إدخال رقم الجوال');
    const teacher = JSON.parse(localStorage.getItem('teacher_' + phone));
    if (teacher) {
        sessionStorage.setItem('currentUser', phone);
        renderTeacherHome(teacher);
    } else {
        alert('لا يوجد حساب بهذا الرقم. إذا كنت دكتور جديد، أنشئ حساب.');
    }
}

function handleCreateTeacher() {
    const name = document.getElementById('teacherName').value.trim();
    const phone = document.getElementById('teacherPhone').value.trim();
    if (!name || !phone) return alert('يرجى تعبئة جميع الحقول');
    if (localStorage.getItem('teacher_' + phone)) {
        alert('يوجد حساب بهذا الرقم بالفعل');
        return;
    }
    const teacher = { name, phone, sessions: [] };
    localStorage.setItem('teacher_' + phone, JSON.stringify(teacher));
    sessionStorage.setItem('currentUser', phone);
    alert('تم إنشاء الحساب بنجاح!');
    renderTeacherHome(teacher);
}

function renderTeacherHome(teacher) {
    app.innerHTML = `
        <div class="title">مرحباً د.${teacher.name}</div>
        <div class="subtitle">أنشئ اختباراً جديداً وشارك الباركود مباشرة مع الطلاب.</div>
        <div class="button-row" style="justify-content:center; margin-bottom:14px;">
            <button id="newSessionBtn" class="btn-start">إنشاء اختبار جديد</button>
        </div>
        <div style="margin:10px 0 8px; font-weight:bold;">الاختبارات السابقة (${teacher.sessions.length || 0}):</div>
        <div id="sessionsList"></div>
        <div class="button-row" style="justify-content:flex-end; margin-top:12px;">
            <button id="logoutBtn" class="btn-secondary">تسجيل خروج</button>
        </div>
    `;
    document.getElementById('newSessionBtn').onclick = () => renderNewSession(teacher);
    document.getElementById('logoutBtn').onclick = () => { sessionStorage.removeItem('currentUser'); renderLogin(); };
    renderSessionsList(teacher);
}

function renderSessionsList(teacher) {
    const list = document.getElementById('sessionsList');
    if (!teacher.sessions.length) {
        list.innerHTML = '<div class="panel muted">لا يوجد اختبارات بعد.</div>';
        return;
    }
    list.innerHTML = teacher.sessions.map((s, i) => {
        const liveBadge = s.started ? `<span class="badge badge-live">نشط</span>` : '';
        const lockedBadge = s.active === false ? `<span class="badge badge-locked">مغلق</span>` : '';
        return `
        <div class="card">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                <div>
                    <div style="font-weight:700; font-size:1.05rem; color:#0f172a;">${s.subject}</div>
                    <div class="muted" style="margin-top:4px;">${s.date}</div>
                </div>
                <div class="inline-actions">${liveBadge} ${lockedBadge}</div>
            </div>
            <div class="session-actions" style="margin-top:10px;">
                <button class="session-btn" data-action="open" data-phone="${teacher.phone}" data-idx="${i}">تفاصيل الجلسة</button>
                <button class="session-btn" data-action="inline" data-phone="${teacher.phone}" data-idx="${i}">الباركود</button>
            </div>
        </div>`;
    }).join('');
    // وصل الأحداث برمجياً لتجنب مشاكل onclick المضمن
    Array.from(list.querySelectorAll('button.session-btn')).forEach(btn => {
        const action = btn.getAttribute('data-action');
        const phone = btn.getAttribute('data-phone');
        const idx = Number(btn.getAttribute('data-idx'));
        if (action === 'open') btn.addEventListener('click', () => renderSessionInfo && renderSessionInfo(phone, idx));
        if (action === 'inline') btn.addEventListener('click', () => window.openSessionWindow && window.openSessionWindow(phone, idx));
    });
    // تعريف دوال للـ onclick على النافذة
    window.renderSessionDetails = (phone, idx) => {
        const t = JSON.parse(localStorage.getItem('teacher_' + phone));
        if (!t) return;
        // حماية ضد الاستدعاءات المتكررة المتداخلة
        if (window._renderSessionDetailsLock) return;
        window._renderSessionDetailsLock = true;
        // نفشل بسرعة ثم نقوم بالتنفيذ بشكل غير متزامن لتجنب إعادة الدخول
        setTimeout(() => {
            try {
                renderSessionDetails(t, idx);
            } finally {
                window._renderSessionDetailsLock = false;
            }
        }, 0);
    };
    window.openSessionWindow = (phone, idx) => {
        const t = JSON.parse(localStorage.getItem('teacher_' + phone));
        if (!t) return alert('لم يتم العثور على بيانات الدكتور');
        const s = t.sessions[idx];
        const studentUrl = getStudentUrl(phone, idx);
        // توليد QR كصورة data URL أولاً
        generateQRDataURL(studentUrl, (qrDataURL) => {
            const win = window.open('', '_blank', 'width=900,height=700');
            const qrHtml = qrDataURL ? `<img src="${qrDataURL}" alt="QR Code" style="max-width:200px; border:2px solid #ddd; border-radius:8px;">` : '<div style="color:#d32f2f;">فشل توليد الباركود</div>';
            const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>تفاصيل الجلسة - ${s.subject}</title>
<style>
body{font-family: 'Tajawal', Arial, sans-serif;background:linear-gradient(180deg,#f6f8fb 0%, #ffffff 100%);margin:0;padding:0;direction:rtl}
#app{max-width:520px;margin:40px auto;background:#fff;border-radius:12px;box-shadow:0 6px 24px rgba(15,23,42,0.06);padding:36px 28px}
input{font-size:1rem;padding:10px;margin:8px 0;border-radius:6px;border:1px solid #ddd;width:100%;box-sizing:border-box}
button{font-size:1rem;padding:10px 14px;margin:8px 4px;border-radius:8px;border:0;background:#3b82f6;color:#fff;cursor:pointer;transition:background .15s;display:inline-block;width:auto}
button:hover{background:#2563eb}
.btn-secondary{background:#eef2f5;color:#333}
.btn-success{background:#4caf50}
.btn-start{background:linear-gradient(90deg,#10b981,#059669);box-shadow:0 4px 12px rgba(6,95,70,0.12)}
.waiting-box{background:#fff7ed;padding:12px;border-radius:8px;color:#78350f;border:1px solid #ffe4bf;margin-top:10px}
.card{background:#f3f6ff;padding:14px 16px;border-radius:10px;margin-bottom:12px}
.session-btn{display:inline-block;min-width:160px}
.session-actions{display:flex;gap:10px;justify-content:center;margin-top:8px}
.qr-box{background:#fff;padding:12px;border-radius:12px;box-shadow:0 2px 8px #e3e8f0}
.button-row{display:flex;justify-content:space-between;gap:12px;width:100%;box-sizing:border-box;margin-top:10px}
.btn-left{margin-left:auto}
.btn-right{margin-right:auto}
.title{font-size:1.4rem;font-weight:bold;margin-bottom:18px;color:#222;text-align:center}
img{max-width:100%}
</style>
</head>
<body>
    <div style="max-width:760px;margin:20px auto;padding:20px;">
        <h2 style="text-align:center;">تفاصيل الجلسة</h2>
        <div style="margin:10px 0;"><b>المادة:</b> ${s.subject}</div>
        <div style="margin:6px 0;"><b>التاريخ:</b> ${s.date}</div>
        <div style="margin:12px 0; text-align:center;">${qrHtml}</div>
        <div style="margin:12px 0; text-align:center;">
            <div>رابط الطالب:</div>
            <div style="margin-top:8px;">
                <button id="openStudentLink" class="session-btn">فتح رابط الطالب</button>
                <button id="copyStudentLink" class="session-btn">نسخ الرابط</button>
            </div>
        </div>
        <div style="margin:12px 0; text-align:center;">
            <div>صورة الباركود:</div>
            <div style="margin-top:8px;">
                ${qrDataURL ? `<button id="openQrImg" class="session-btn">فتح صورة الباركود</button><button id="copyQrLink" class="session-btn">نسخ رابط الصورة</button>` : `<div style="color:#d32f2f; margin-top:6px;">لا توجد صورة الباركود</div>`}
            </div>
        </div>
        <div style="margin-top:18px;">
            <h3>الأسئلة</h3>
            <ol>${s.questions.map(q=>`<li style="margin-bottom:8px;"><b>${q.type}</b>: ${q.text}${q.type==='اختيارات'?`<ul style="margin-top:6px;">${q.options.map(o=>`<li>${o}</li>`).join('')}</ul>`:''}</li>`).join('')}</ol>
        </div>
        <div style="text-align:center; margin-top:16px;"><button id="closeBtn" class="btn-secondary">إغلاق</button></div>
    </div>
    <script>
        document.getElementById('closeBtn').onclick = ()=> window.close();
        // ربط أزرار فتح ونسخ الروابط
        (function(){
            const studentUrl = ${JSON.stringify(studentUrl)};
            try{
                const openBtn = document.getElementById('openStudentLink');
                const copyBtn = document.getElementById('copyStudentLink');
                if (openBtn) openBtn.onclick = ()=> window.open(studentUrl, '_blank');
                if (copyBtn) copyBtn.onclick = ()=> { navigator.clipboard && navigator.clipboard.writeText(studentUrl); alert('نسخ رابط الطالب'); };
            } catch(e){ /* ignore */ }
            try{
                const openQr = document.getElementById('openQrImg');
                const copyQr = document.getElementById('copyQrLink');
                if (openQr) openQr.onclick = ()=> { window.open(${JSON.stringify(qrDataURL)}, '_blank'); };
                if (copyQr) copyQr.onclick = ()=> { navigator.clipboard && navigator.clipboard.writeText(${JSON.stringify(qrDataURL)}); alert('نسخ رابط صورة الباركود'); };
            } catch(e){ /* ignore */ }
        })();
    </script>
</body>
</html>`;
            win.document.write(html);
            win.document.close();
        });
    };
}
// دالة لتوليد QR كصورة data URL
function generateQRDataURL(text, callback) {
    // نجعل التحميل موحدًا ثم نحاول توليد dataURL
    ensureQRCodeLib(function(available){
        if (!available) return callback(null);
        const tempDiv = document.createElement('div');
        tempDiv.style.display = 'none';
        document.body.appendChild(tempDiv);
        try {
            new window.QRCode(tempDiv, { text: text, width: 200, height: 200 });
            setTimeout(() => {
                const canvas = tempDiv.querySelector('canvas');
                if (canvas) {
                    try {
                        const dataURL = canvas.toDataURL('image/png');
                        document.body.removeChild(tempDiv);
                        callback(dataURL);
                    } catch(e) {
                        document.body.removeChild(tempDiv);
                        callback(null);
                    }
                } else {
                    document.body.removeChild(tempDiv);
                    callback(null);
                }
            }, 100);
        } catch (e) {
            try { document.body.removeChild(tempDiv); } catch(_){}
            callback(null);
        }
    });
}
// صفحة تفاصيل الجلسة وتوليد الباركود
function renderSessionDetails(teacher, sessionIdx) {
    const session = teacher.sessions[sessionIdx];
    const studentUrl = getStudentUrl(teacher.phone, sessionIdx);
    app.innerHTML = `
        <div class="title">تفاصيل الجلسة</div>
        <div class="subtitle">شارك الباركود مباشرة، أو انسخ الرابط للطلاب.</div>
        <div class="card" style="margin-bottom:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
                <div>
                    <div style="font-weight:700; font-size:1.08rem;">${session.subject}</div>
                    <div class="muted">${session.date}</div>
                </div>
                <div class="inline-actions">
                    <span class="badge ${session.started ? 'badge-live' : ''}">${session.started ? 'نشط' : 'لم يبدأ'}</span>
                    ${session.active === false ? '<span class="badge badge-locked">مغلق</span>' : ''}
                </div>
            </div>
        </div>
        <div class="qr-box" style="text-align:center;">
            <div id="qrcode"></div>
            <div class="panel" style="margin-top:12px; word-break:break-all; color:#1d4ed8;">
                رابط الطالب:<br><span id="studentUrl">${studentUrl}</span>
            </div>
            <div class="button-row" style="margin-top:12px;">
                <button id="copyUrlBtn" class="session-btn">نسخ الرابط</button>
                <button id="downloadQrBtn" class="session-btn">حفظ صورة الباركود</button>
                <button id="openStudentBtn" class="session-btn">فتح واجهة طالب</button>
                <button id="startExamBtn" class="session-btn btn-start">${session.started? 'إيقاف الاختبار':'بدء الاختبار'}</button>
                <button id="toggleActiveBtn" class="session-btn">${session.active===false? 'فتح الباركود':'قفل الباركود'}</button>
                <button id="showResultsBtn" class="session-btn btn-secondary">عرض النتائج</button>
            </div>
            <div style="margin-top:10px; width:100%; text-align:center;"><img id="qrcodeImg" alt="QR" style="max-width:160px; border-radius:10px; display:block; margin:6px auto;"></div>
        </div>
        <div class="button-row" style="justify-content:center; margin-top:14px;"><button id="backBtn" class="btn-ghost">رجوع</button></div>
    `;
    // تحميل/توليد QR: نجرب توليد data-URL أولاً، ثم نحاول تحميل المكتبة محلياً/من CDN كبدائل
    function showQR() {
        const qrEl = document.getElementById('qrcode');
        if (!qrEl) return;
        qrEl.innerHTML = '';
        // نحاول توليد data-URL أولاً، وإن فشل نحاول تحميل المكتبة (أو استخدامها إذا تمت بالفعل)
        generateQRDataURL(studentUrl, (dataURL) => {
            if (dataURL) {
                qrEl.innerHTML = `<img src="${dataURL}" style="max-width:160px; border-radius:6px;">`;
                const img = document.getElementById('qrcodeImg');
                if (img) img.src = dataURL;
                return;
            }
            // جرب تحميل/استخدام المكتبة ثم إنشاء QR مباشرة
            ensureQRCodeLib(function(available){
                if (!available) {
                    qrEl.innerHTML = `<div style="color:#d32f2f; text-align:center;">فشل تحميل مكتبة توليد الباركود. انسخ رابط الطالب أدناه:<br><div style="word-break:break-all; margin-top:8px;">${studentUrl}</div></div>`;
                    return;
                }
                try {
                    new window.QRCode(qrEl, { text: studentUrl, width: 160, height: 160 });
                    setTimeout(()=>{
                        const canvas = qrEl.querySelector('canvas');
                        const img = document.getElementById('qrcodeImg');
                        if (canvas && img) {
                            try { img.src = canvas.toDataURL('image/png'); } catch(e){ console.warn('Could not create image from canvas after instantiate', e); }
                        }
                    }, 50);
                } catch (e) {
                    console.error('QR generation error after ensureQRCodeLib', e);
                    qrEl.innerHTML = '<div style="color:#d32f2f; text-align:center;">فشل توليد الباركود — راجع الكونسول.</div>';
                }
            });
        });
    }
    // نستخدم showQR مباشرة (generateQRDataURL سيحاول تحميل المكتبة إذا كانت مفقودة)
    showQR();
    document.getElementById('copyUrlBtn').onclick = () => {
        navigator.clipboard.writeText(studentUrl);
        alert('تم نسخ الرابط!');
    };
    // زر لفتح واجهة الطالب في نافذة جديدة
    document.getElementById('openStudentBtn').onclick = () => {
        window.open(studentUrl, '_blank');
    };
    // زر لحفظ صورة الباركود - ننتظر أن يتواجد الكانفس بعد التوليد
    document.getElementById('downloadQrBtn').onclick = () => {
        const canvas = document.querySelector('#qrcode canvas');
        const img = document.getElementById('qrcodeImg');
        if (canvas) {
            const dataUrl = canvas.toDataURL('image/png');
            if (img) img.src = dataUrl;
            // فتح الصورة في تبويب جديد
            const w = window.open('about:blank');
            w.document.write(`<img src="${dataUrl}" alt="QR">`);
            // محاولة تنزيل الصورة
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = `${session.subject || 'qr'}_${sessionIdx}.png`;
            a.click();
        } else {
            alert('لا يمكن الوصول إلى صورة الباركود حالياً. حاول بعد قليل.');
        }
    };
    // زر بدء / إيقاف الاختبار
    document.getElementById('startExamBtn').onclick = () => {
        session.started = !session.started;
        const phone = teacher.phone;
        const t = JSON.parse(localStorage.getItem('teacher_' + phone));
        t.sessions[sessionIdx] = session;
        localStorage.setItem('teacher_' + phone, JSON.stringify(t));
        document.getElementById('startExamBtn').textContent = session.started ? 'إيقاف الاختبار' : 'بدء الاختبار';
        // كتابة الحالة إلى JSONBin للمزامنة الفورية
        writeSessionState(phone, sessionIdx, { started: session.started, active: session.active !== false });
        // عند البدء، نعلم الطلاب المنتظرين عبر حفظ حالة البدء (الطلاب لديهم Polling)
        if (session.started) {
            // يمكن إضافة لوج هنا أو إظهار نافذة منبثقة
            alert('تم بدء الاختبار. الطلاب الذين سجلوا سابقًا سيدخلون الآن.');
        } else {
            alert('تم إيقاف الاختبار.');
        }
    };
    // تفعيل/إيقاف الجلسة (قفل الباركود)
    document.getElementById('toggleActiveBtn').onclick = () => {
        session.active = session.active === false ? true : false;
        const phone = teacher.phone;
        const t = JSON.parse(localStorage.getItem('teacher_' + phone));
        t.sessions[sessionIdx] = session;
        localStorage.setItem('teacher_' + phone, JSON.stringify(t));
        document.getElementById('toggleActiveBtn').textContent = session.active === false ? 'فتح الباركود' : 'قفل الباركود';
        // كتابة الحالة إلى JSONBin
        writeSessionState(phone, sessionIdx, { started: session.started === true, active: session.active !== false });
        alert('تم تحديث حالة الجلسة');
    };
    document.getElementById('backBtn').onclick = () => renderTeacherHome(teacher);
    document.getElementById('showResultsBtn').onclick = () => renderSessionResults(teacher, sessionIdx);
}

// عرض معلومات الجلسة بدون إظهار الباركود (زر لفتح الباركود يظهر بدلاً منه)
function renderSessionInfo(phone, sessionIdx) {
    const t = JSON.parse(localStorage.getItem('teacher_' + phone));
    if (!t) return alert('لم يتم العثور على بيانات الدكتور');
    const session = t.sessions[sessionIdx];
    const readyKey = `ready_${phone}_${sessionIdx}`;
    const readyList = JSON.parse(localStorage.getItem(readyKey) || '[]');
    const submittedCount = JSON.parse(localStorage.getItem(`answers_${phone}_${sessionIdx}`) || '[]').length;
    app.innerHTML = `
        <div class="title">معلومات الجلسة</div>
        <div class="card" style="margin-bottom:14px;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                <div>
                    <div style="font-weight:700; font-size:1.05rem;">${session.subject}</div>
                    <div class="muted">${session.date}</div>
                    <div class="muted" style="margin-top:6px;">عدد الأسئلة: <b>${session.questions.length}</b></div>
                </div>
                <div class="inline-actions">
                    <span class="badge ${session.started ? 'badge-live' : ''}">${session.started ? 'نشط' : 'لم يبدأ'}</span>
                    ${session.active === false ? '<span class="badge badge-locked">مغلق</span>' : ''}
                </div>
            </div>
        </div>
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">الحالة</div>
                <div class="stat-value">${session.started ? 'نشط' : 'لم يبدأ'}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">إتاحة الباركود</div>
                <div class="stat-value">${session.active === false ? 'مغلق' : 'مفتوح'}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">طلاب بانتظار البدء</div>
                <div class="stat-value">${readyList.length}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">إجابات مستلمة</div>
                <div class="stat-value">${submittedCount}</div>
            </div>
        </div>
        <div class="button-row" style="margin-top:10px;">
            <button id="openQrBtn" class="session-btn">عرض الباركود</button>
            <button id="startExamBtn" class="session-btn btn-start">${session.started? 'إيقاف الاختبار':'بدء الاختبار'}</button>
            <button id="toggleActiveBtn" class="session-btn">${session.active===false? 'فتح الباركود':'قفل الباركود'}</button>
            <button id="showResultsBtn" class="session-btn btn-secondary">عرض النتائج</button>
        </div>
        <div class="button-row" style="justify-content:center; margin-top:12px;"><button id="backBtn" class="btn-ghost">رجوع</button></div>
    `;
    document.getElementById('openQrBtn').onclick = () => window.openSessionWindow && window.openSessionWindow(phone, sessionIdx);
    document.getElementById('startExamBtn').onclick = () => {
        session.started = !session.started;
        t.sessions[sessionIdx] = session;
        localStorage.setItem('teacher_' + phone, JSON.stringify(t));
        document.getElementById('startExamBtn').textContent = session.started ? 'إيقاف الاختبار' : 'بدء الاختبار';
        writeSessionState(phone, sessionIdx, { started: session.started, active: session.active !== false });
        alert(session.started ? 'تم بدء الاختبار.' : 'تم إيقاف الاختبار.');
    };
    document.getElementById('toggleActiveBtn').onclick = () => {
        session.active = session.active === false ? true : false;
        t.sessions[sessionIdx] = session;
        localStorage.setItem('teacher_' + phone, JSON.stringify(t));
        document.getElementById('toggleActiveBtn').textContent = session.active===false? 'فتح الباركود':'قفل الباركود';
        writeSessionState(phone, sessionIdx, { started: session.started === true, active: session.active !== false });
        alert('تم تحديث حالة الجلسة');
    };
    document.getElementById('showResultsBtn').onclick = () => renderSessionResults(t, sessionIdx);
    document.getElementById('backBtn').onclick = () => renderTeacherHome(t);
}

// عرض نتائج الطلاب
function renderSessionResults(teacher, sessionIdx) {
    const session = teacher.sessions[sessionIdx];
    const key = `answers_${teacher.phone}_${sessionIdx}`;
    const answers = JSON.parse(localStorage.getItem(key) || '[]');
    let html = `<div class=\"title\">نتائج الطلاب</div><div class=\"subtitle\">تفاصيل الدرجات لكل طالب في هذه الجلسة.</div>`;
    if (!answers.length) {
        html += '<div class="panel muted">لا توجد إجابات بعد.</div>';
    } else {
        html += `<table style='font-size:0.97em;'>
            <tr><th>الاسم</th><th>السجل</th><th>الدرجة</th><th>تفاصيل</th></tr>`;
        answers.forEach((a, i) => {
            const score = calcStudentScore(session, a.answers);
            html += `<tr style='text-align:center; border-bottom:1px solid #eee;'>
                <td>${a.studentName}</td>
                <td>${a.studentId}</td>
                <td>${score} / ${session.questions.length}</td>
                <td><button onclick='window.showStudentDetails("${teacher.phone}",${sessionIdx},${i})'>عرض</button></td>
            </tr>`;
        });
        html += `</table>`;
    }
    html += `<div class=\"button-row\" style=\"justify-content:flex-end; margin-top:14px;\"><button id=\"backBtn\" class=\"btn-ghost\">رجوع</button></div>`;
    app.innerHTML = html;
    window.showStudentDetails = (phone, sIdx, aIdx) => {
        const t = JSON.parse(localStorage.getItem('teacher_' + phone));
        const ans = JSON.parse(localStorage.getItem(`answers_${phone}_${sIdx}`) || '[]');
        renderStudentDetails(t, sIdx, ans[aIdx]);
    };
    document.getElementById('backBtn').onclick = () => renderSessionDetails(teacher, sessionIdx);
}

function calcStudentScore(session, answers) {
    let score = 0;
    answers.forEach(a => {
        const q = session.questions[a.qIdx];
        if (!q) return;
        if (q.type === 'اختيارات') {
            if (Number(a.ans) === q.correct) score++;
        } else if (q.type === 'صح أو خطأ') {
            if (a.ans === q.correct) score++;
        } else if (q.type === 'أكمل الفراغ') {
            if (a.ans.trim() === q.correct.trim()) score++;
        }
    });
    return score;
}

function renderStudentDetails(teacher, sessionIdx, answerObj) {
    const session = teacher.sessions[sessionIdx];
    let html = `<div class=\"title\">تفاصيل إجابات الطالب</div>`;
    html += `<div class=\"card\" style='margin-bottom:12px;'>
                <div><b>الاسم:</b> ${answerObj.studentName}</div>
                <div><b>السجل:</b> ${answerObj.studentId}</div>
                <div style='margin:10px 0;'><b>الدرجة:</b> ${calcStudentScore(session, answerObj.answers)} / ${session.questions.length}</div>
            </div>`;
    html += `<ol style='padding-right:18px;'>`;
    answerObj.answers.forEach(a => {
        const q = session.questions[a.qIdx];
        html += `<li style='margin-bottom:8px;'><b>${q.text}</b><br>إجابة الطالب: <span style='color:#2563eb;'>${a.ans}</span><br>الإجابة الصحيحة: <span style='color:#4caf50;'>${q.type==='اختيارات'?q.options[q.correct]:q.correct}</span></li>`;
    });
    html += `</ol>`;
    html += `<div class=\"button-row\" style=\"justify-content:flex-end; margin-top:14px;\"><button id=\"backBtn\" class=\"btn-ghost\">رجوع</button></div>`;
    app.innerHTML = html;
    document.getElementById('backBtn').onclick = () => renderSessionResults(teacher, sessionIdx);
}

function renderNewSession(teacher) {
    app.innerHTML = `
        <div class="title">إنشاء اختبار جديد</div>
        <div class="subtitle">أدخل بيانات المادة والتاريخ، ثم أضف الأسئلة.</div>
        <label>اسم المادة</label>
        <input type="text" id="subject" placeholder="مثال: رياضيات 101">
        <label>تاريخ الاختبار</label>
        <input type="date" id="date">
        <div class="button-row" style="margin-top:12px;">
            <button id="createSessionBtn" class="btn-start">التالي</button>
            <button id="backBtn" class="btn-secondary">رجوع</button>
        </div>
    `;
    document.getElementById('createSessionBtn').onclick = () => {
        const subject = document.getElementById('subject').value.trim();
        const date = document.getElementById('date').value;
        if (!subject || !date) return alert('يرجى تعبئة جميع الحقول');
        renderQuestionBuilder(teacher, { subject, date, questions: [] });
    };
    document.getElementById('backBtn').onclick = () => renderTeacherHome(teacher);
}

function renderQuestionBuilder(teacher, session) {
    app.innerHTML = `
        <div class="title">إضافة أسئلة للاختبار</div>
        <div id="questionsList"></div>
        <div class="button-row" style="margin-top:12px;">
            <button id="addQBtn">إضافة سؤال</button>
            <button id="finishBtn" class="btn-success">إنهاء وحفظ الاختبار</button>
            <button id="backBtn" class="btn-secondary">رجوع</button>
        </div>
    `;
    document.getElementById('addQBtn').onclick = () => renderAddQuestion(teacher, session);
    document.getElementById('finishBtn').onclick = () => {
        if (!session.questions.length) return alert('أضف سؤال واحد على الأقل');
        // حفظ الجلسة
        const phone = teacher.phone;
        const t = JSON.parse(localStorage.getItem('teacher_' + phone));
        session.active = true; // الجلسة مُفعّلة افتراضياً
        t.sessions.push(session);
        localStorage.setItem('teacher_' + phone, JSON.stringify(t));
        // إنشاء bin للمزامنة
        writeSessionState(phone, t.sessions.length - 1, { started: false, active: true });
        alert('تم حفظ الاختبار!');
        renderTeacherHome(t);
    };
    document.getElementById('backBtn').onclick = () => renderNewSession(teacher);
    renderQuestionsList(session);
}

function renderQuestionsList(session) {
    const list = document.getElementById('questionsList');
    if (!session.questions.length) {
        list.innerHTML = '<div class="panel muted">لا يوجد أسئلة بعد.</div>';
        return;
    }
    list.innerHTML = session.questions.map((q, i) => `
        <div class="card" style="padding:12px 14px;">
            <div><b>نوع السؤال:</b> ${q.type}</div>
            <div style="margin-top:6px;"><b>السؤال:</b> ${q.text}</div>
        </div>
    `).join('');
}

function renderAddQuestion(teacher, session) {
    app.innerHTML = `
        <div class="title">إضافة سؤال</div>
        <label>نوع السؤال</label>
        <select id="qType">
            <option value="صح أو خطأ">صح أو خطأ</option>
            <option value="اختيارات">اختيارات</option>
            <option value="أكمل الفراغ">أكمل الفراغ</option>
        </select>
        <label>نص السؤال</label>
        <input type="text" id="qText" placeholder="اكتب السؤال هنا">
        <div id="qOptions"></div>
        <div class="button-row" style="margin-top:12px;">
            <button id="nextBtn" class="btn-start">التالي</button>
            <button id="backBtn" class="btn-secondary">رجوع</button>
        </div>
    `;
    document.getElementById('qType').onchange = renderQOptions;
    document.getElementById('nextBtn').onclick = () => handleAddQ(teacher, session);
    document.getElementById('backBtn').onclick = () => renderQuestionBuilder(teacher, session);
    renderQOptions();
}

function renderQOptions() {
    const type = document.getElementById('qType').value;
    const qOptions = document.getElementById('qOptions');
    if (type === 'اختيارات') {
        qOptions.innerHTML = `
            <label>الاختيار 1</label><input type="text" id="opt1">
            <label>الاختيار 2</label><input type="text" id="opt2">
            <label>الاختيار 3</label><input type="text" id="opt3">
            <label>الاختيار 4</label><input type="text" id="opt4">
            <label>الإجابة الصحيحة (رقم 1-4)</label><input type="number" id="correctOpt" min="1" max="4">
        `;
    } else if (type === 'صح أو خطأ') {
        qOptions.innerHTML = `
            <label>الإجابة الصحيحة</label>
            <select id="correctOpt">
                <option value="صح">صح</option>
                <option value="خطأ">خطأ</option>
            </select>
        `;
    } else if (type === 'أكمل الفراغ') {
        qOptions.innerHTML = `
            <label>الإجابة الصحيحة</label><input type="text" id="correctOpt">
        `;
    }
}

function handleAddQ(teacher, session) {
    const type = document.getElementById('qType').value;
    const text = document.getElementById('qText').value.trim();
    if (!text) return alert('يرجى كتابة نص السؤال');
    let q = { type, text };
    if (type === 'اختيارات') {
        const opts = [1,2,3,4].map(i => document.getElementById('opt'+i).value.trim());
        const correct = parseInt(document.getElementById('correctOpt').value);
        if (opts.some(o => !o) || !correct || correct < 1 || correct > 4) return alert('يرجى تعبئة جميع الخيارات وتحديد الإجابة الصحيحة');
        q.options = opts;
        q.correct = correct - 1;
    } else if (type === 'صح أو خطأ') {
        q.correct = document.getElementById('correctOpt').value;
    } else if (type === 'أكمل الفراغ') {
        q.correct = document.getElementById('correctOpt').value.trim();
        if (!q.correct) return alert('يرجى كتابة الإجابة الصحيحة');
    }
    session.questions.push(q);
    renderQuestionBuilder(teacher, session);
}

// --- صفحة الطالب ---
function renderStudentEntry(teacherPhone, sessionIdx) {
    const session = JSON.parse(localStorage.getItem('teacher_' + teacherPhone)).sessions[sessionIdx];
    
    // فحص إذا كان الطالب بدأ الاختبار من قبل (منع إعادة الدخول)
    const savedStudentId = sessionStorage.getItem('studentId');
    if (savedStudentId) {
        const examStartedKey = `exam_started_${teacherPhone}_${sessionIdx}_${savedStudentId}`;
        if (sessionStorage.getItem(examStartedKey)) {
            app.innerHTML = `
                <div class="title">لقد بدأت الاختبار من قبل</div>
                <div style="color:#d32f2f; margin-top:12px;">عذراً، لا يمكنك إعادة الدخول بعد بدء الاختبار.</div>
            `;
            return;
        }
    }
    
    app.innerHTML = `
        <div class="title">دخول الطالب للاختبار</div>
        <div class="subtitle">أدخل بياناتك ثم انتظر بدء الاختبار من الدكتور.</div>
        <label>اسم الطالب</label>
        <input type="text" id="studentName" placeholder="أدخل اسمك">
        <label>السجل الأكاديمي</label>
        <input type="text" id="studentId" placeholder="أدخل رقم السجل الأكاديمي">
        <div class="button-row" style="justify-content:center; margin-top:10px;"><button id="startExamBtn" class="btn-start">التسجيل والانتظار</button></div>
        <div id="waitArea"></div>
    `;
    document.getElementById('startExamBtn').onclick = () => {
        const name = document.getElementById('studentName').value.trim();
        const id = document.getElementById('studentId').value.trim();
        if (!name || !id) return alert('يرجى تعبئة جميع الحقول');
        // حفظ بيانات الطالب مؤقتاً
        sessionStorage.setItem('studentName', name);
        sessionStorage.setItem('studentId', id);
        // سجل الطالب في قائمة الانتظار في localStorage
        const readyKey = `ready_${teacherPhone}_${sessionIdx}`;
        let arr = JSON.parse(localStorage.getItem(readyKey) || '[]');
        // إزالة أي مدخل سابق لنفس السجل ثم إضافة
        arr = arr.filter(r=>r.studentId !== id);
        arr.push({studentName: name, studentId: id, time: new Date().toISOString()});
        localStorage.setItem(readyKey, JSON.stringify(arr));
        renderStudentWaiting(teacherPhone, sessionIdx, name, id);
    };
}

function renderStudentWaiting(teacherPhone, sessionIdx, name, id) {
    let poll;
    app.innerHTML = `
        <div class="title">انتظار بدء الاختبار</div>
        <div class="waiting-box">تم تسجيلك، يرجى الانتظار حتى يبدأ الدكتور الاختبار.</div>
        <div style="margin-top:12px;">الاسم: <b>${name}</b></div>
        <div>السجل: <b>${id}</b></div>
        <div style="margin-top:12px; text-align:center;"><button id="cancelWaitBtn" class="btn-secondary">إلغاء التسجيل</button></div>
    `;
    document.getElementById('cancelWaitBtn').onclick = () => {
        clearInterval(poll);
        const readyKey = `ready_${teacherPhone}_${sessionIdx}`;
        let arr = JSON.parse(localStorage.getItem(readyKey) || '[]');
        arr = arr.filter(r=>r.studentId !== id);
        localStorage.setItem(readyKey, JSON.stringify(arr));
        renderStudentEntry(teacherPhone, sessionIdx);
    };
    // محاولة قراءة الحالة من JSONBin للمزامنة الفورية بين الأجهزة
    const urlParams = new URLSearchParams(window.location.search);
    const binId = urlParams.get('bin');
    console.log('🔗 Bin ID من الرابط:', binId);
    if (binId) {
        localStorage.setItem(`bin_${teacherPhone}_${sessionIdx}`, binId);
        console.log('💾 تم حفظ Bin ID في localStorage');
    } else {
        console.warn('⚠️ لا يوجد bin في الرابط - سيعمل polling المحلي فقط');
    }
    
    // polling مزدوج: localStorage (للعمل المحلي) + JSONBin (للأجهزة البعيدة)
    poll = setInterval(()=>{
        // فحص localStorage أولاً (للعمل على نفس الجهاز)
        const t = JSON.parse(localStorage.getItem('teacher_' + teacherPhone));
        if (!t || !t.sessions[sessionIdx]) {
            clearInterval(poll);
            app.innerHTML = `<div class="title">الجلسة غير موجودة</div><div>الجلسة تم حذفها أو غير موجودة.</div>`;
            return;
        }
        const s = t.sessions[sessionIdx];
        if (s.started) {
            clearInterval(poll);
            // حذف من قائمة الانتظار
            const readyKey = `ready_${teacherPhone}_${sessionIdx}`;
            let arr = JSON.parse(localStorage.getItem(readyKey) || '[]');
            arr = arr.filter(r=>r.studentId !== id);
            localStorage.setItem(readyKey, JSON.stringify(arr));
            renderStudentExam(teacherPhone, sessionIdx, name, id);
        } else if (s.active === false) {
            clearInterval(poll);
            app.innerHTML = `<div class="title">الجلسة مغلقة</div><div>عذراً، هذه الجلسة غير متاحة حالياً.</div>`;
        }
        
        // فحص JSONBin للمزامنة مع الأجهزة البعيدة
        readSessionState(teacherPhone, sessionIdx, remoteState => {
            if (!remoteState) return;
            console.log('🔄 حالة الجلسة من JSONBin:', remoteState);
            if (remoteState.started) {
                clearInterval(poll);
                const readyKey = `ready_${teacherPhone}_${sessionIdx}`;
                let arr = JSON.parse(localStorage.getItem(readyKey) || '[]');
                arr = arr.filter(r=>r.studentId !== id);
                localStorage.setItem(readyKey, JSON.stringify(arr));
                renderStudentExam(teacherPhone, sessionIdx, name, id);
            } else if (remoteState.active === false) {
                clearInterval(poll);
                app.innerHTML = `<div class="title">الجلسة مغلقة</div><div>عذراً، هذه الجلسة غير متاحة حالياً.</div>`;
            }
        });
    }, 1000);
}

function renderStudentExam(teacherPhone, sessionIdx, studentName, studentId) {
    const teacher = JSON.parse(localStorage.getItem('teacher_' + teacherPhone));
    const session = teacher.sessions[sessionIdx];
    
    // حفظ أن الطالب بدأ الاختبار (لمنع إعادة الدخول)
    const examStartedKey = `exam_started_${teacherPhone}_${sessionIdx}_${studentId}`;
    sessionStorage.setItem(examStartedKey, 'true');
    
    // حفظ أو استرجاع ترتيب الأسئلة المخلوطة
    const shuffleKey = `shuffled_${teacherPhone}_${sessionIdx}_${studentId}`;
    let questions;
    const savedShuffle = sessionStorage.getItem(shuffleKey);
    if (savedShuffle) {
        questions = JSON.parse(savedShuffle);
    } else {
        questions = session.questions.map((q, i) => ({...q, idx: i}));
        questions = shuffleArray(questions);
        sessionStorage.setItem(shuffleKey, JSON.stringify(questions));
    }
    
    let current = 0;
    let answers = [];
    let kicked = false;
    // حماية ضد الغش
    function kick(reason) {
        kicked = true;
        app.innerHTML = `<div class=\"title\">تم إخراجك من الاختبار</div><div style='color:#d32f2f;'>${reason}</div>`;
    }
    function showQ(idx) {
        if (kicked) return;
        const q = questions[idx];
        let html = `<div class=\"title\">سؤال ${idx+1} من ${questions.length}</div>`;
        html += `<div style=\"margin-bottom:12px; font-weight:bold;\">${q.text}</div>`;
        if (q.type === 'اختيارات') {
            q.options.forEach((opt, i) => {
                html += `<div><input type='radio' name='ans' value='${i}' id='opt${i}'><label for='opt${i}'> ${opt}</label></div>`;
            });
        } else if (q.type === 'صح أو خطأ') {
            html += `<div><input type='radio' name='ans' value='صح' id='true'><label for='true'> صح</label></div>`;
            html += `<div><input type='radio' name='ans' value='خطأ' id='false'><label for='false'> خطأ</label></div>`;
        } else if (q.type === 'أكمل الفراغ') {
            html += `<input type='text' id='ansText' placeholder='اكتب إجابتك هنا'>`;
        }
        html += `<button id='nextBtn' style='margin-top:16px;'>التالي</button>`;
        app.innerHTML = html;
        document.getElementById('nextBtn').onclick = () => {
            let ans;
            if (q.type === 'اختيارات' || q.type === 'صح أو خطأ') {
                const sel = document.querySelector('input[name=\"ans\"]:checked');
                if (!sel) return alert('اختر إجابة');
                ans = sel.value;
            } else {
                ans = document.getElementById('ansText').value.trim();
                if (!ans) return alert('اكتب إجابتك');
            }
            answers.push({qIdx: q.idx, ans});
            if (idx + 1 < questions.length) {
                showQ(idx + 1);
            } else {
                renderStudentFinish(teacherPhone, sessionIdx, studentName, studentId, answers);
            }
        };
        // منع الرجوع
        window.onpopstate = () => { location.reload(); };
        // حماية ضد الغش
        window.onblur = () => { if (!kicked) kick('تم اكتشاف محاولة غش (الخروج من الصفحة)'); };
        window.onfocus = () => {};
        window.onbeforeunload = (e) => {
            if (!kicked) {
                kick('تم اكتشاف محاولة غش (إعادة تحميل أو إغلاق الصفحة)');
                e.preventDefault();
                e.returnValue = '';
            }
        };
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible' && !kicked) {
                kick('تم اكتشاف محاولة غش (تبديل النافذة)');
            }
        });
    }
    showQ(current);
}

function renderStudentFinish(teacherPhone, sessionIdx, studentName, studentId, answers) {
    // حفظ الإجابات في LocalStorage
    const key = `answers_${teacherPhone}_${sessionIdx}`;
    let all = JSON.parse(localStorage.getItem(key) || '[]');
    all.push({studentName, studentId, answers, time: new Date().toISOString()});
    localStorage.setItem(key, JSON.stringify(all));
    
    // حساب الدرجة
    const teacher = JSON.parse(localStorage.getItem('teacher_' + teacherPhone));
    const session = teacher.sessions[sessionIdx];
    let correct = 0;
    let resultHtml = '';
    
    answers.forEach((a, i) => {
        const q = session.questions[a.qIdx];
        const isCorrect = String(a.ans).trim().toLowerCase() === String(q.correct).trim().toLowerCase();
        if (isCorrect) correct++;
        
        const icon = isCorrect ? '✅' : '❌';
        const color = isCorrect ? '#4caf50' : '#d32f2f';
        resultHtml += `
            <div class="card" style="border-right: 4px solid ${color}; margin-bottom: 12px;">
                <div style="font-weight: bold; margin-bottom: 6px;">${icon} سؤال ${i+1}: ${q.text}</div>
                <div>• إجابتك: <span style="color:${color};font-weight:bold;">${a.ans}</span></div>
                ${!isCorrect ? `<div>• الإجابة الصحيحة: <span style="color:#4caf50;font-weight:bold;">${q.correct}</span></div>` : ''}
            </div>
        `;
    });
    
    const percentage = Math.round((correct / answers.length) * 100);
    const grade = percentage >= 50 ? '🎉 ناجح' : '😞 راسب';
    const gradeColor = percentage >= 50 ? '#4caf50' : '#d32f2f';
    
    app.innerHTML = `
        <div class="title">تم إرسال إجاباتك بنجاح</div>
        <div class="card" style="text-align:center; background: linear-gradient(135deg, ${gradeColor}22, ${gradeColor}11); border: 2px solid ${gradeColor};">
            <h2 style="color:${gradeColor}; margin: 8px 0;">${grade}</h2>
            <div style="font-size: 18px; font-weight: bold;">درجتك: ${correct} من ${answers.length}</div>
            <div style="font-size: 16px; color: #666;">${percentage}%</div>
        </div>
        <div style="margin-top: 20px;">
            <h3>تفاصيل الإجابات:</h3>
            ${resultHtml}
        </div>
        <div style="text-align:center; margin-top:20px; color:#666;">شكراً لمشاركتك!</div>
    `;
    
    // مسح بيانات الجلسة لمنع إعادة الدخول
    sessionStorage.clear();
}

// دالة خلط مصفوفة
function shuffleArray(array) {
    let arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// --- التوجيه عند فتح الموقع ---
const urlParams = new URLSearchParams(window.location.search);
const sessionParam = urlParams.get('session');
const dataParam = urlParams.get('data');
if (sessionParam && sessionParam.includes('_')) {
    const [teacherPhone, sessionIdx] = sessionParam.split('_');
    let t = JSON.parse(localStorage.getItem('teacher_' + teacherPhone) || 'null');
    // إذا لم توجد بيانات محلياً، نحاول فكها من رابط data
    if ((!t || !t.sessions || !t.sessions[Number(sessionIdx)]) && dataParam) {
        const snap = decodePayload(dataParam);
        if (snap && snap.teacher && snap.session) {
            const merged = t || { name: snap.teacher.name || '', phone: snap.teacher.phone || teacherPhone, sessions: [] };
            merged.sessions = merged.sessions || [];
            merged.sessions[Number(sessionIdx)] = snap.session;
            localStorage.setItem('teacher_' + merged.phone, JSON.stringify(merged));
            t = merged;
        }
    }
    if (!t) {
        app.innerHTML = `<div class="title">الجلسة غير موجودة</div><div>رمز الجلسة غير صحيح أو تم حذفه.</div>`;
    } else if (!t.sessions[Number(sessionIdx)] || t.sessions[Number(sessionIdx)].active === false) {
        app.innerHTML = `<div class="title">الجلسة مغلقة</div><div>عذراً، هذه الجلسة غير متاحة حالياً.</div>`;
    } else {
        renderStudentEntry(teacherPhone, Number(sessionIdx));
    }
} else {
    const currentUser = sessionStorage.getItem('currentUser');
    if (currentUser) {
        const teacher = JSON.parse(localStorage.getItem('teacher_' + currentUser));
        if (teacher) {
            renderTeacherHome(teacher);
        } else {
            sessionStorage.removeItem('currentUser');
            renderLogin();
        }
    } else {
        renderLogin();
    }
}
