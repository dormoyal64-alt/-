/**
 * ביובית בדרום — main.js
 * No external dependencies. Handles: config injection, tracking stubs,
 * scroll-reveal animations, and the contact form fallback flow.
 */
(function () {
  "use strict";

  var CFG = window.SITE_CONFIG || {};

  /* ----------------------------------------------------------
     1. Inject business details wherever the markup asks for them
     ---------------------------------------------------------- */
  function applyConfig() {
    var isPlaceholder = function (v) {
      return !v || /^REPLACE_/.test(v);
    };

    // Phone links
    var phoneReady = !isPlaceholder(CFG.phoneE164);
    document.querySelectorAll("[data-role='phone-link']").forEach(function (el) {
      if (phoneReady) {
        el.setAttribute("href", "tel:" + CFG.phoneE164);
      } else {
        el.setAttribute("href", "#contact-form");
        el.setAttribute("data-phone-pending", "true");
      }
    });
    document.querySelectorAll("[data-role='phone-display']").forEach(function (el) {
      if (!isPlaceholder(CFG.phoneDisplay)) el.textContent = CFG.phoneDisplay;
    });

    // WhatsApp links
    var waReady = !isPlaceholder(CFG.whatsappNumber);
    document.querySelectorAll("[data-role='whatsapp-link']").forEach(function (el) {
      if (waReady) {
        var text = encodeURIComponent(el.getAttribute("data-wa-text") || CFG.whatsappPrefillText || "");
        el.setAttribute("href", "https://wa.me/" + CFG.whatsappNumber + (text ? "?text=" + text : ""));
      } else {
        el.setAttribute("href", "#contact-form");
        el.setAttribute("data-whatsapp-pending", "true");
      }
    });

    // Business name
    document.querySelectorAll("[data-role='business-name']").forEach(function (el) {
      el.textContent = CFG.businessName || "ביובית בדרום";
    });

    // Service areas
    var areasList = document.querySelector("[data-role='areas-list']");
    var areasFallback = document.querySelector("[data-role='areas-fallback']");
    if (CFG.serviceAreas && CFG.serviceAreas.length && areasList) {
      areasList.innerHTML = "";
      CFG.serviceAreas.forEach(function (area) {
        var li = document.createElement("li");
        li.textContent = area;
        areasList.appendChild(li);
      });
      areasList.hidden = false;
      if (areasFallback) areasFallback.hidden = true;
    } else {
      if (areasList) areasList.hidden = true;
      if (areasFallback) areasFallback.hidden = false;
    }

    // Hours (only if provided)
    var hoursEl = document.querySelector("[data-role='hours']");
    if (hoursEl) {
      if (CFG.hours) {
        hoursEl.textContent = CFG.hours;
        hoursEl.hidden = false;
      } else {
        hoursEl.hidden = true;
      }
    }

    // Google reviews link
    document.querySelectorAll("[data-role='google-reviews-link']").forEach(function (el) {
      if (CFG.googleReviewsUrl) {
        el.setAttribute("href", CFG.googleReviewsUrl);
      } else {
        el.setAttribute("aria-disabled", "true");
        el.addEventListener("click", function (e) { e.preventDefault(); });
      }
    });
  }

  /* ----------------------------------------------------------
     2. Tracking stubs — wired to gtag/fbq only if those are loaded
     ---------------------------------------------------------- */
  function trackEvent(eventName) {
    try {
      if (typeof window.gtag === "function") {
        window.gtag("event", eventName);
        var label = CFG.tracking && CFG.tracking.googleAdsConversionLabels && CFG.tracking.googleAdsConversionLabels[eventName];
        if (label && CFG.tracking.googleAdsConversionId) {
          window.gtag("event", "conversion", { send_to: CFG.tracking.googleAdsConversionId + "/" + label });
        }
      }
      if (typeof window.fbq === "function") {
        window.fbq("trackCustom", eventName);
      }
    } catch (err) {
      /* tracking must never break the page */
    }
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      console.log("[track]", eventName);
    }
  }

  function wireTracking() {
    document.querySelectorAll("[data-track]").forEach(function (el) {
      el.addEventListener("click", function () {
        trackEvent(el.getAttribute("data-track"));
      });
    });
  }

  /* ----------------------------------------------------------
     3. Scroll-reveal animation (IntersectionObserver, no library)
     ---------------------------------------------------------- */
  function wireReveal() {
    var els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window) || !els.length) {
      els.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }
    var io = new IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    els.forEach(function (el) { io.observe(el); });
  }

  /* ----------------------------------------------------------
     4. Contact form — posts to CFG.formEndpoint if set, otherwise
        falls back to a pre-filled WhatsApp message.
     ---------------------------------------------------------- */
  function wireForm() {
    var form = document.getElementById("contact-form-el");
    if (!form) return;
    var successEl = document.querySelector("[data-role='form-success']");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = (form.querySelector("#field-name") || {}).value || "";
      var phone = (form.querySelector("#field-phone") || {}).value || "";
      var problem = (form.querySelector("#field-problem") || {}).value || "";

      trackEvent("form_submit");

      if (CFG.formEndpoint) {
        fetch(CFG.formEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name, phone: phone, problem: problem, source: "landing-page" })
        }).catch(function () { /* fall through to WhatsApp fallback below */ });
        showSuccess();
        return;
      }

      var waReady = CFG.whatsappNumber && !/^REPLACE_/.test(CFG.whatsappNumber);
      if (waReady) {
        var msg = "פנייה חדשה מדף הנחיתה:%0Aשם: " + encodeURIComponent(name) +
          "%0Aטלפון: " + encodeURIComponent(phone) +
          "%0Aתיאור הבעיה: " + encodeURIComponent(problem);
        window.location.href = "https://wa.me/" + CFG.whatsappNumber + "?text=" + msg;
      } else {
        showSuccess();
      }
    });

    function showSuccess() {
      form.reset();
      if (successEl) successEl.classList.add("is-visible");
    }
  }

  /* ----------------------------------------------------------
     5. Virtual assistant — rule-based, answers mirror the FAQ
        section verbatim. No external API, no cost, nothing invented.
     ---------------------------------------------------------- */
  var ASSISTANT_FAQ = [
    { q: "כמה עולה לשחרר סתימת ביוב?", a: "שחרור סתימת ביוב מתחיל מ-₪499, והמחיר הסופי משתנה לפי סוג התקלה והעבודה הנדרשת. צרו קשר, ספרו לנו מה הבעיה ונוכל לתת לכם מידע ראשוני לפני ההגעה ככל שניתן." },
    { q: "אתם מגיעים לכל אזור הדרום?", a: "אנחנו נותנים שירות באזור הדרום. שלחו לנו את היישוב ונבדוק זמינות." },
    { q: "אפשר לשלוח תמונה ב-WhatsApp?", a: "כן. במקרים רבים תמונה או סרטון יכולים לעזור להבין טוב יותר את סוג הבעיה לפני ההגעה." },
    { q: "הביוב נסתם שוב. מה עושים?", a: "סתימה שחוזרת יכולה להצביע על בעיה עמוקה יותר בקו. חשוב להבין את סוג החסימה ואת מיקומה לפני שמחליטים על דרך הטיפול." },
    { q: "כמה מהר אפשר להגיע?", a: "הזמינות משתנה בהתאם למיקום ולעומס הקריאות. אנחנו שמים דגש על זמינות גבוהה ומענה מהיר ככל האפשר." }
  ];

  function wireAssistant() {
    var toggle = document.getElementById("assistant-toggle");
    var panel = document.getElementById("assistant-panel");
    var closeBtn = document.getElementById("assistant-close");
    var body = document.getElementById("assistant-body");
    var quick = document.getElementById("assistant-quick");
    if (!toggle || !panel || !body || !quick) return;

    function addMessage(text, from) {
      var div = document.createElement("div");
      div.className = "assistant-msg assistant-msg--" + from;
      div.textContent = text;
      body.appendChild(div);
      body.scrollTop = body.scrollHeight;
    }

    function renderQuickReplies() {
      quick.innerHTML = "";
      ASSISTANT_FAQ.forEach(function (item) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = item.q;
        btn.addEventListener("click", function () {
          addMessage(item.q, "user");
          window.setTimeout(function () { addMessage(item.a, "bot"); }, 300);
        });
        quick.appendChild(btn);
      });
    }

    function openPanel() {
      panel.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      trackEvent("ai_assistant_open");
      closeBtn.focus();
    }
    function closePanel() {
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      toggle.focus();
    }

    toggle.addEventListener("click", function () {
      if (panel.hidden) openPanel(); else closePanel();
    });
    closeBtn.addEventListener("click", closePanel);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !panel.hidden) closePanel();
    });

    renderQuickReplies();
  }

  document.addEventListener("DOMContentLoaded", function () {
    applyConfig();
    wireTracking();
    wireReveal();
    wireForm();
    wireAssistant();
  });
})();
