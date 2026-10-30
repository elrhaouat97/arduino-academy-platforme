/* ============================================================
   وحدة زر الاشتراك الرسمي من يوتيوب — أكاديمية الأردوينو
   ------------------------------------------------------------
   لماذا هذه الوحدة المنفصلة؟
   طلب الأستاذ (2026-10-30) أن يتم الاشتراك في قناة النادي من داخل
   صفحة الدرس نفسها، دون أن يُنقل التلميذ إلى موقع يوتيوب. الطريق
   الوحيد الذي يتيحه يوتيوب رسميًا لأي موقع هو زر الاشتراك الرسمي
   (g-ytsubscribe) من مكتبة Google Platform: نقرة واحدة على الزر،
   نافذة تأكيد صغيرة من Google عند الحاجة (أو تسجيل دخول إن لم يكن
   التلميذ داخلًا بحسابه — قاعدة يوتيوب على كل المواقع)، ثم يتحول
   الزر في مكانه إلى «مشترك» دون مغادرة الصفحة.

   العزل: app.js لا يحمل أي مرجع Google (قاعدة المنصة)؛ هو يحقن هذا
   الملف كسولًا عند عرض درس على الموقع الحي https فقط، وهذا الملف
   وحده يحمّل platform.js الرسمي. عند أي تعذّر (انقطاع، حظر، متصفح
   قديم) لا ينكسر شيء: يبقى رابط الاشتراك الاحتياطي ظاهرًا في الشريط.
   ============================================================ */
(function () {
  "use strict";

  var CHANNEL_ID = "UC4lRBYW3L2sZ9m-6_pXdcuw"; // قناة Ai & Robotics Club
  var PLATFORM_SRC = "https://apis.google.com/js/platform.js";
  var loading = false;
  var ready = false;

  function paint() {
    if (!window.gapi || !window.gapi.ytsubscribe) return;
    var slots = document.querySelectorAll(".yt-sub-slot");
    Array.prototype.forEach.call(slots, function (slot) {
      if (slot.getAttribute("data-rendered")) return;
      slot.setAttribute("data-rendered", "1");
      try {
        window.gapi.ytsubscribe.render(slot, {
          channelid: CHANNEL_ID,
          layout: "default",
          count: "hidden"
        });
        var bar = slot.closest ? slot.closest(".yt-channel-bar") : null;
        if (bar) bar.classList.add("yt-sub-live");
      } catch (e) {
        slot.removeAttribute("data-rendered");
      }
    });
  }

  function renderAll() {
    if (!document.querySelector(".yt-sub-slot")) return;
    if (ready) { paint(); return; }
    if (loading) return;
    loading = true;
    var s = document.createElement("script");
    s.src = PLATFORM_SRC;
    s.async = true;
    s.onload = function () {
      ready = true;
      paint();
    };
    s.onerror = function () {
      /* يبقى الرابط الاحتياطي ظاهرًا — لا إجراء */
      loading = false;
    };
    document.head.appendChild(s);
  }

  window.AcademyYtSubscribe = { renderAll: renderAll };
})();
