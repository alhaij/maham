// Saudia (Alfursan) destinations — bundled so the city autocomplete works
// instantly and offline. Each entry: IATA code, English + Arabic names, city.
// The server can also refresh this live from Saudia (see SAUDIA_AIRPORTS_URL
// in .env); this list is the built-in fallback / default.
export const AIRPORTS = [
  // ── Saudi Arabia (domestic) ──
  { code: 'JED', en: 'Jeddah',            ar: 'جدة',            country: 'SA' },
  { code: 'RUH', en: 'Riyadh',            ar: 'الرياض',         country: 'SA' },
  { code: 'DMM', en: 'Dammam',            ar: 'الدمام',         country: 'SA' },
  { code: 'MED', en: 'Madinah',           ar: 'المدينة المنورة', country: 'SA' },
  { code: 'AHB', en: 'Abha',              ar: 'أبها',           country: 'SA' },
  { code: 'GIZ', en: 'Jazan',             ar: 'جازان',          country: 'SA' },
  { code: 'TUU', en: 'Tabuk',             ar: 'تبوك',           country: 'SA' },
  { code: 'YNB', en: 'Yanbu',             ar: 'ينبع',           country: 'SA' },
  { code: 'HAS', en: 'Hail',              ar: 'حائل',           country: 'SA' },
  { code: 'ELQ', en: 'Qassim (Buraidah)', ar: 'القصيم — بريدة',  country: 'SA' },
  { code: 'TIF', en: 'Taif',              ar: 'الطائف',         country: 'SA' },
  { code: 'EAM', en: 'Najran',            ar: 'نجران',          country: 'SA' },
  { code: 'ABT', en: 'Al Baha',           ar: 'الباحة',         country: 'SA' },
  { code: 'RAE', en: 'Arar',              ar: 'عرعر',           country: 'SA' },
  { code: 'SHW', en: 'Sharurah',          ar: 'شرورة',          country: 'SA' },
  { code: 'WAE', en: 'Wadi ad-Dawasir',   ar: 'وادي الدواسر',    country: 'SA' },
  { code: 'URY', en: 'Gurayat',           ar: 'القريات',        country: 'SA' },
  { code: 'AJF', en: 'Al-Jouf',           ar: 'الجوف',          country: 'SA' },
  { code: 'RAH', en: 'Rafha',             ar: 'رفحاء',          country: 'SA' },
  { code: 'BHH', en: 'Bisha',             ar: 'بيشة',           country: 'SA' },
  { code: 'DWD', en: 'Dawadmi',           ar: 'الدوادمي',       country: 'SA' },
  { code: 'ULH', en: 'AlUla',             ar: 'العُلا',          country: 'SA' },
  { code: 'NUM', en: 'NEOM Bay',          ar: 'نيوم',           country: 'SA' },
  { code: 'AQI', en: 'Qaisumah',          ar: 'القيصومة',       country: 'SA' },
  { code: 'EJH', en: 'Wejh',              ar: 'الوجه',          country: 'SA' },

  // ── Gulf & Middle East ──
  { code: 'DXB', en: 'Dubai',             ar: 'دبي',            country: 'AE' },
  { code: 'AUH', en: 'Abu Dhabi',         ar: 'أبوظبي',         country: 'AE' },
  { code: 'SHJ', en: 'Sharjah',           ar: 'الشارقة',        country: 'AE' },
  { code: 'DOH', en: 'Doha',              ar: 'الدوحة',         country: 'QA' },
  { code: 'BAH', en: 'Bahrain',           ar: 'البحرين',        country: 'BH' },
  { code: 'KWI', en: 'Kuwait',            ar: 'الكويت',         country: 'KW' },
  { code: 'MCT', en: 'Muscat',            ar: 'مسقط',           country: 'OM' },
  { code: 'AMM', en: 'Amman',             ar: 'عمّان',          country: 'JO' },
  { code: 'BEY', en: 'Beirut',            ar: 'بيروت',          country: 'LB' },
  { code: 'BGW', en: 'Baghdad',           ar: 'بغداد',          country: 'IQ' },
  { code: 'NJF', en: 'Najaf',             ar: 'النجف',          country: 'IQ' },
  { code: 'BSR', en: 'Basra',             ar: 'البصرة',         country: 'IQ' },
  { code: 'SAH', en: 'Sanaa',             ar: 'صنعاء',          country: 'YE' },

  // ── Egypt & Africa ──
  { code: 'CAI', en: 'Cairo',             ar: 'القاهرة',        country: 'EG' },
  { code: 'HBE', en: 'Alexandria',        ar: 'الإسكندرية',      country: 'EG' },
  { code: 'KRT', en: 'Khartoum',          ar: 'الخرطوم',        country: 'SD' },
  { code: 'ADD', en: 'Addis Ababa',       ar: 'أديس أبابا',      country: 'ET' },
  { code: 'NBO', en: 'Nairobi',           ar: 'نيروبي',         country: 'KE' },
  { code: 'LOS', en: 'Lagos',             ar: 'لاغوس',          country: 'NG' },
  { code: 'JNB', en: 'Johannesburg',      ar: 'جوهانسبرغ',      country: 'ZA' },
  { code: 'CMN', en: 'Casablanca',        ar: 'الدار البيضاء',   country: 'MA' },
  { code: 'TUN', en: 'Tunis',             ar: 'تونس',           country: 'TN' },

  // ── Türkiye & Europe ──
  { code: 'IST', en: 'Istanbul',          ar: 'إسطنبول',        country: 'TR' },
  { code: 'LHR', en: 'London Heathrow',   ar: 'لندن',           country: 'GB' },
  { code: 'MAN', en: 'Manchester',        ar: 'مانشستر',        country: 'GB' },
  { code: 'CDG', en: 'Paris',             ar: 'باريس',          country: 'FR' },
  { code: 'FRA', en: 'Frankfurt',         ar: 'فرانكفورت',      country: 'DE' },
  { code: 'MUC', en: 'Munich',            ar: 'ميونخ',          country: 'DE' },
  { code: 'MAD', en: 'Madrid',            ar: 'مدريد',          country: 'ES' },
  { code: 'BCN', en: 'Barcelona',         ar: 'برشلونة',        country: 'ES' },
  { code: 'FCO', en: 'Rome',              ar: 'روما',           country: 'IT' },
  { code: 'MXP', en: 'Milan',             ar: 'ميلانو',         country: 'IT' },
  { code: 'GVA', en: 'Geneva',            ar: 'جنيف',           country: 'CH' },
  { code: 'VIE', en: 'Vienna',            ar: 'فيينا',          country: 'AT' },
  { code: 'AMS', en: 'Amsterdam',         ar: 'أمستردام',       country: 'NL' },
  { code: 'BRU', en: 'Brussels',          ar: 'بروكسل',         country: 'BE' },
  { code: 'ATH', en: 'Athens',            ar: 'أثينا',          country: 'GR' },

  // ── South & East Asia ──
  { code: 'BOM', en: 'Mumbai',            ar: 'مومباي',         country: 'IN' },
  { code: 'DEL', en: 'Delhi',             ar: 'دلهي',           country: 'IN' },
  { code: 'HYD', en: 'Hyderabad',         ar: 'حيدر آباد',      country: 'IN' },
  { code: 'MAA', en: 'Chennai',           ar: 'تشيناي',         country: 'IN' },
  { code: 'COK', en: 'Kochi',             ar: 'كوتشي',          country: 'IN' },
  { code: 'BLR', en: 'Bengaluru',         ar: 'بنغالورو',       country: 'IN' },
  { code: 'CCJ', en: 'Kozhikode',         ar: 'كوجيكود',        country: 'IN' },
  { code: 'CMB', en: 'Colombo',           ar: 'كولومبو',        country: 'LK' },
  { code: 'DAC', en: 'Dhaka',             ar: 'دكا',            country: 'BD' },
  { code: 'KHI', en: 'Karachi',           ar: 'كراتشي',         country: 'PK' },
  { code: 'LHE', en: 'Lahore',            ar: 'لاهور',          country: 'PK' },
  { code: 'ISB', en: 'Islamabad',         ar: 'إسلام آباد',      country: 'PK' },
  { code: 'PEW', en: 'Peshawar',          ar: 'بيشاور',         country: 'PK' },
  { code: 'SKT', en: 'Sialkot',           ar: 'سيالكوت',        country: 'PK' },
  { code: 'MUX', en: 'Multan',            ar: 'مُلتان',          country: 'PK' },
  { code: 'CGK', en: 'Jakarta',           ar: 'جاكرتا',         country: 'ID' },
  { code: 'KUL', en: 'Kuala Lumpur',      ar: 'كوالالمبور',      country: 'MY' },
  { code: 'MNL', en: 'Manila',            ar: 'مانيلا',         country: 'PH' },
  { code: 'BKK', en: 'Bangkok',           ar: 'بانكوك',         country: 'TH' },
  { code: 'CAN', en: 'Guangzhou',         ar: 'قوانغجو',        country: 'CN' },
  { code: 'PEK', en: 'Beijing',           ar: 'بكين',           country: 'CN' },

  // ── Americas ──
  { code: 'JFK', en: 'New York',          ar: 'نيويورك',        country: 'US' },
  { code: 'IAD', en: 'Washington DC',     ar: 'واشنطن',         country: 'US' },
  { code: 'LAX', en: 'Los Angeles',       ar: 'لوس أنجلوس',     country: 'US' },
  { code: 'YYZ', en: 'Toronto',           ar: 'تورونتو',        country: 'CA' },
];

// Rank matches: exact code > code prefix > word-start in name > substring.
export function searchAirports(q, limit = 8) {
  const s = (q || '').trim().toLowerCase();
  if (!s) return AIRPORTS.slice(0, limit);
  const scored = [];
  for (const a of AIRPORTS) {
    const code = a.code.toLowerCase();
    const en = a.en.toLowerCase();
    const ar = a.ar;
    let score = -1;
    if (code === s) score = 0;
    else if (code.startsWith(s)) score = 1;
    else if (en.startsWith(s)) score = 2;
    else if (en.split(/\s+/).some((w) => w.startsWith(s))) score = 3;
    else if (ar.startsWith(q.trim())) score = 3;
    else if (en.includes(s)) score = 4;
    else if (ar.includes(q.trim())) score = 4;
    else if (code.includes(s)) score = 5;
    if (score >= 0) scored.push({ a, score });
  }
  scored.sort((x, y) => x.score - y.score || x.a.en.localeCompare(y.a.en));
  return scored.slice(0, limit).map((x) => x.a);
}
