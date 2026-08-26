/**
 * ============================================================================
 * SITE CONFIG — single place to edit all business details & tracking IDs.
 * Every REPLACE_* value below is a placeholder. Nothing here was invented
 * (no fake reviews, ratings, prices, years of experience or coverage areas).
 * Fill in the real values before publishing the page.
 * ============================================================================
 */
window.SITE_CONFIG = {
  businessName: "ביובית בדרום",

  // בעל העסק
  ownerName: "REPLACE_OWNER_NAME", // לדוגמה: "יוסי כהן"

  // טלפון — נדרש פורמט בינלאומי עבור קישור החיוג
  phoneDisplay: "052-8893809",
  phoneE164: "+972528893809",

  // WhatsApp — מספר בפורמט בינלאומי, ללא + וללא רווחים
  whatsappNumber: "972528893809",
  whatsappPrefillText: "היי, יש לי סתימת ביוב ואני צריך/ה עזרה. אפשר בבקשה פרטים?",

  // אזורי שירות — הרחבת "מגיעים לכל אזור הדרום" לפי בקשת בעל העסק
  serviceAreas: [
    "באר שבע", "אשקלון", "אשדוד", "נתיבות", "אופקים", "דימונה", "ערד",
    "שדרות", "רהט", "קריית גת", "קריית מלאכי", "ירוחם", "מצפה רמון", "אילת",
    "מועצה אזורית אשכול", "מועצה אזורית בני שמעון", "מועצה אזורית מרחבים",
    "מועצה אזורית שער הנגב", "מועצה אזורית לכיש", "מועצה אזורית רמת הנגב"
  ],

  // שעות פעילות — יוצג רק אם הוגדר
  hours: "", // לדוגמה: "א׳-ה׳ 07:00-19:00"

  // שירותי חירום מחוץ לשעות הפעילות — יוצג רק אם true/false הוגדר במפורש
  emergencyService: null, // true / false / null (לא מוצג)

  // ביקורות גוגל
  googleReviewsUrl: "", // לדוגמה: "https://g.page/r/xxxxxxxxxx/review"

  // לוגו ותמונות אמיתיות — נתיבים להעלאה. כל עוד לא הועלו, יוצג Placeholder מעוצב
  logoUrl: "", // לדוגמה: "/assets/img/logo.png"
  images: {
    owner: "", // תמונת בעל המקצוע
    vehicle: "", // תמונת רכב העבודה
    beforeAfter: "", // לפני/אחרי
    jobPhotos: [] // עבודות שבוצעו
  },

  // ============================================================
  // Tracking — placeholders only. Do NOT invent real IDs.
  // Leave empty to keep the relevant snippet disabled.
  // ============================================================
  tracking: {
    ga4MeasurementId: "", // "G-XXXXXXXXXX"
    googleAdsConversionId: "AW-18404266699", 
    googleAdsConversionLabels: {
      phone_click: "", // "AW-XXXXXXXXX/xxxxxxxxxxxxxxxxxxxx"
      whatsapp_click: "",
      form_submit: "AW-18404266699/PTJbCNGHougcEMul68dE
",
      hero_cta_click: ""
    },
    metaPixelId: "" // "XXXXXXXXXXXXXXX"
  },

  // Optional: real backend endpoint for the contact form (e.g. a Sheets/CRM
  // webhook). If empty, the form falls back to a pre-filled WhatsApp message.
  formEndpoint: ""
};
