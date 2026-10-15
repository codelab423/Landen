// All 195 countries (193 UN members + Vatican City + Palestine), ranked from
// the point of view of a family living in the Netherlands.
//
// Tier 1 = easy (close by, cheap, no visa)  →  Tier 5 = legendary (remote,
// expensive, closed off or dangerous). Every tier is worth a fixed amount of XP.
//
// Shared by the server (require) and the browser (window.LANDEN).
(function (root) {
  var TIERS = {
    1: { xp: 50, color: '#22c55e', nl: 'Makkelijk', en: 'Easy' },
    2: { xp: 100, color: '#3b82f6', nl: 'Gemiddeld', en: 'Medium' },
    3: { xp: 200, color: '#a855f7', nl: 'Avontuurlijk', en: 'Adventurous' },
    4: { xp: 350, color: '#f97316', nl: 'Uitdagend', en: 'Challenging' },
    5: { xp: 500, color: '#ef4444', nl: 'Legendarisch', en: 'Legendary' },
  };

  var CONTINENTS = {
    EU: { nl: 'Europa', en: 'Europe' },
    AS: { nl: 'Azië', en: 'Asia' },
    AF: { nl: 'Afrika', en: 'Africa' },
    NA: { nl: 'Noord-Amerika', en: 'North America' },
    SA: { nl: 'Zuid-Amerika', en: 'South America' },
    OC: { nl: 'Oceanië', en: 'Oceania' },
  };

  // [alpha-2, ISO numeric (= world map id), Dutch name, English name, continent, tier]
  var RAW = [
    // Europe
    ['AL', '008', 'Albanië', 'Albania', 'EU', 2],
    ['AD', '020', 'Andorra', 'Andorra', 'EU', 1],
    ['AT', '040', 'Oostenrijk', 'Austria', 'EU', 1],
    ['BY', '112', 'Belarus', 'Belarus', 'EU', 4],
    ['BE', '056', 'België', 'Belgium', 'EU', 1],
    ['BA', '070', 'Bosnië en Herzegovina', 'Bosnia and Herzegovina', 'EU', 2],
    ['BG', '100', 'Bulgarije', 'Bulgaria', 'EU', 2],
    ['HR', '191', 'Kroatië', 'Croatia', 'EU', 1],
    ['CY', '196', 'Cyprus', 'Cyprus', 'EU', 2],
    ['CZ', '203', 'Tsjechië', 'Czechia', 'EU', 1],
    ['DK', '208', 'Denemarken', 'Denmark', 'EU', 1],
    ['EE', '233', 'Estland', 'Estonia', 'EU', 2],
    ['FI', '246', 'Finland', 'Finland', 'EU', 2],
    ['FR', '250', 'Frankrijk', 'France', 'EU', 1],
    ['DE', '276', 'Duitsland', 'Germany', 'EU', 1],
    ['GR', '300', 'Griekenland', 'Greece', 'EU', 1],
    ['HU', '348', 'Hongarije', 'Hungary', 'EU', 1],
    ['IS', '352', 'IJsland', 'Iceland', 'EU', 2],
    ['IE', '372', 'Ierland', 'Ireland', 'EU', 1],
    ['IT', '380', 'Italië', 'Italy', 'EU', 1],
    ['LV', '428', 'Letland', 'Latvia', 'EU', 2],
    ['LI', '438', 'Liechtenstein', 'Liechtenstein', 'EU', 1],
    ['LT', '440', 'Litouwen', 'Lithuania', 'EU', 2],
    ['LU', '442', 'Luxemburg', 'Luxembourg', 'EU', 1],
    ['MT', '470', 'Malta', 'Malta', 'EU', 1],
    ['MD', '498', 'Moldavië', 'Moldova', 'EU', 3],
    ['MC', '492', 'Monaco', 'Monaco', 'EU', 1],
    ['ME', '499', 'Montenegro', 'Montenegro', 'EU', 2],
    ['NL', '528', 'Nederland', 'Netherlands', 'EU', 1],
    ['MK', '807', 'Noord-Macedonië', 'North Macedonia', 'EU', 2],
    ['NO', '578', 'Noorwegen', 'Norway', 'EU', 1],
    ['PL', '616', 'Polen', 'Poland', 'EU', 1],
    ['PT', '620', 'Portugal', 'Portugal', 'EU', 1],
    ['RO', '642', 'Roemenië', 'Romania', 'EU', 2],
    ['RU', '643', 'Rusland', 'Russia', 'EU', 4],
    ['SM', '674', 'San Marino', 'San Marino', 'EU', 1],
    ['RS', '688', 'Servië', 'Serbia', 'EU', 2],
    ['SK', '703', 'Slowakije', 'Slovakia', 'EU', 1],
    ['SI', '705', 'Slovenië', 'Slovenia', 'EU', 1],
    ['ES', '724', 'Spanje', 'Spain', 'EU', 1],
    ['SE', '752', 'Zweden', 'Sweden', 'EU', 1],
    ['CH', '756', 'Zwitserland', 'Switzerland', 'EU', 1],
    ['UA', '804', 'Oekraïne', 'Ukraine', 'EU', 4],
    ['GB', '826', 'Verenigd Koninkrijk', 'United Kingdom', 'EU', 1],
    ['VA', '336', 'Vaticaanstad', 'Vatican City', 'EU', 1],

    // Asia
    ['AF', '004', 'Afghanistan', 'Afghanistan', 'AS', 5],
    ['AM', '051', 'Armenië', 'Armenia', 'AS', 3],
    ['AZ', '031', 'Azerbeidzjan', 'Azerbaijan', 'AS', 3],
    ['BH', '048', 'Bahrein', 'Bahrain', 'AS', 3],
    ['BD', '050', 'Bangladesh', 'Bangladesh', 'AS', 4],
    ['BT', '064', 'Bhutan', 'Bhutan', 'AS', 4],
    ['BN', '096', 'Brunei', 'Brunei', 'AS', 4],
    ['KH', '116', 'Cambodja', 'Cambodia', 'AS', 3],
    ['CN', '156', 'China', 'China', 'AS', 3],
    ['GE', '268', 'Georgië', 'Georgia', 'AS', 2],
    ['IN', '356', 'India', 'India', 'AS', 3],
    ['ID', '360', 'Indonesië', 'Indonesia', 'AS', 2],
    ['IR', '364', 'Iran', 'Iran', 'AS', 4],
    ['IQ', '368', 'Irak', 'Iraq', 'AS', 5],
    ['IL', '376', 'Israël', 'Israel', 'AS', 3],
    ['JP', '392', 'Japan', 'Japan', 'AS', 3],
    ['JO', '400', 'Jordanië', 'Jordan', 'AS', 3],
    ['KZ', '398', 'Kazachstan', 'Kazakhstan', 'AS', 3],
    ['KW', '414', 'Koeweit', 'Kuwait', 'AS', 3],
    ['KG', '417', 'Kirgizië', 'Kyrgyzstan', 'AS', 4],
    ['LA', '418', 'Laos', 'Laos', 'AS', 3],
    ['LB', '422', 'Libanon', 'Lebanon', 'AS', 4],
    ['MY', '458', 'Maleisië', 'Malaysia', 'AS', 3],
    ['MV', '462', 'Malediven', 'Maldives', 'AS', 3],
    ['MN', '496', 'Mongolië', 'Mongolia', 'AS', 4],
    ['MM', '104', 'Myanmar', 'Myanmar', 'AS', 4],
    ['NP', '524', 'Nepal', 'Nepal', 'AS', 3],
    ['KP', '408', 'Noord-Korea', 'North Korea', 'AS', 5],
    ['OM', '512', 'Oman', 'Oman', 'AS', 3],
    ['PK', '586', 'Pakistan', 'Pakistan', 'AS', 4],
    ['PS', '275', 'Palestina', 'Palestine', 'AS', 4],
    ['PH', '608', 'Filipijnen', 'Philippines', 'AS', 3],
    ['QA', '634', 'Qatar', 'Qatar', 'AS', 2],
    ['SA', '682', 'Saoedi-Arabië', 'Saudi Arabia', 'AS', 3],
    ['SG', '702', 'Singapore', 'Singapore', 'AS', 2],
    ['KR', '410', 'Zuid-Korea', 'South Korea', 'AS', 3],
    ['LK', '144', 'Sri Lanka', 'Sri Lanka', 'AS', 3],
    ['SY', '760', 'Syrië', 'Syria', 'AS', 5],
    ['TJ', '762', 'Tadzjikistan', 'Tajikistan', 'AS', 4],
    ['TH', '764', 'Thailand', 'Thailand', 'AS', 2],
    ['TL', '626', 'Oost-Timor', 'Timor-Leste', 'AS', 5],
    ['TR', '792', 'Turkije', 'Turkey', 'AS', 1],
    ['TM', '795', 'Turkmenistan', 'Turkmenistan', 'AS', 5],
    ['AE', '784', 'Verenigde Arabische Emiraten', 'United Arab Emirates', 'AS', 2],
    ['UZ', '860', 'Oezbekistan', 'Uzbekistan', 'AS', 3],
    ['VN', '704', 'Vietnam', 'Vietnam', 'AS', 3],
    ['YE', '887', 'Jemen', 'Yemen', 'AS', 5],

    // Africa
    ['DZ', '012', 'Algerije', 'Algeria', 'AF', 4],
    ['AO', '024', 'Angola', 'Angola', 'AF', 4],
    ['BJ', '204', 'Benin', 'Benin', 'AF', 4],
    ['BW', '072', 'Botswana', 'Botswana', 'AF', 3],
    ['BF', '854', 'Burkina Faso', 'Burkina Faso', 'AF', 5],
    ['BI', '108', 'Burundi', 'Burundi', 'AF', 5],
    ['CV', '132', 'Kaapverdië', 'Cabo Verde', 'AF', 2],
    ['CM', '120', 'Kameroen', 'Cameroon', 'AF', 4],
    ['CF', '140', 'Centraal-Afrikaanse Republiek', 'Central African Republic', 'AF', 5],
    ['TD', '148', 'Tsjaad', 'Chad', 'AF', 5],
    ['KM', '174', 'Comoren', 'Comoros', 'AF', 4],
    ['CG', '178', 'Congo-Brazzaville', 'Republic of the Congo', 'AF', 4],
    ['CD', '180', 'Congo-Kinshasa', 'DR Congo', 'AF', 5],
    ['DJ', '262', 'Djibouti', 'Djibouti', 'AF', 4],
    ['EG', '818', 'Egypte', 'Egypt', 'AF', 2],
    ['GQ', '226', 'Equatoriaal-Guinea', 'Equatorial Guinea', 'AF', 5],
    ['ER', '232', 'Eritrea', 'Eritrea', 'AF', 5],
    ['SZ', '748', 'Eswatini', 'Eswatini', 'AF', 3],
    ['ET', '231', 'Ethiopië', 'Ethiopia', 'AF', 4],
    ['GA', '266', 'Gabon', 'Gabon', 'AF', 4],
    ['GM', '270', 'Gambia', 'Gambia', 'AF', 3],
    ['GH', '288', 'Ghana', 'Ghana', 'AF', 3],
    ['GN', '324', 'Guinee', 'Guinea', 'AF', 4],
    ['GW', '624', 'Guinee-Bissau', 'Guinea-Bissau', 'AF', 5],
    ['CI', '384', 'Ivoorkust', 'Ivory Coast', 'AF', 3],
    ['KE', '404', 'Kenia', 'Kenya', 'AF', 3],
    ['LS', '426', 'Lesotho', 'Lesotho', 'AF', 4],
    ['LR', '430', 'Liberia', 'Liberia', 'AF', 4],
    ['LY', '434', 'Libië', 'Libya', 'AF', 5],
    ['MG', '450', 'Madagaskar', 'Madagascar', 'AF', 4],
    ['MW', '454', 'Malawi', 'Malawi', 'AF', 4],
    ['ML', '466', 'Mali', 'Mali', 'AF', 5],
    ['MR', '478', 'Mauritanië', 'Mauritania', 'AF', 4],
    ['MU', '480', 'Mauritius', 'Mauritius', 'AF', 3],
    ['MA', '504', 'Marokko', 'Morocco', 'AF', 2],
    ['MZ', '508', 'Mozambique', 'Mozambique', 'AF', 4],
    ['NA', '516', 'Namibië', 'Namibia', 'AF', 3],
    ['NE', '562', 'Niger', 'Niger', 'AF', 5],
    ['NG', '566', 'Nigeria', 'Nigeria', 'AF', 4],
    ['RW', '646', 'Rwanda', 'Rwanda', 'AF', 4],
    ['ST', '678', 'Sao Tomé en Principe', 'São Tomé and Príncipe', 'AF', 4],
    ['SN', '686', 'Senegal', 'Senegal', 'AF', 3],
    ['SC', '690', 'Seychellen', 'Seychelles', 'AF', 3],
    ['SL', '694', 'Sierra Leone', 'Sierra Leone', 'AF', 4],
    ['SO', '706', 'Somalië', 'Somalia', 'AF', 5],
    ['ZA', '710', 'Zuid-Afrika', 'South Africa', 'AF', 3],
    ['SS', '728', 'Zuid-Soedan', 'South Sudan', 'AF', 5],
    ['SD', '729', 'Soedan', 'Sudan', 'AF', 5],
    ['TZ', '834', 'Tanzania', 'Tanzania', 'AF', 3],
    ['TG', '768', 'Togo', 'Togo', 'AF', 4],
    ['TN', '788', 'Tunesië', 'Tunisia', 'AF', 2],
    ['UG', '800', 'Oeganda', 'Uganda', 'AF', 3],
    ['ZM', '894', 'Zambia', 'Zambia', 'AF', 4],
    ['ZW', '716', 'Zimbabwe', 'Zimbabwe', 'AF', 3],

    // North & Central America, Caribbean
    ['AG', '028', 'Antigua en Barbuda', 'Antigua and Barbuda', 'NA', 3],
    ['BS', '044', "Bahama's", 'Bahamas', 'NA', 3],
    ['BB', '052', 'Barbados', 'Barbados', 'NA', 3],
    ['BZ', '084', 'Belize', 'Belize', 'NA', 3],
    ['CA', '124', 'Canada', 'Canada', 'NA', 2],
    ['CR', '188', 'Costa Rica', 'Costa Rica', 'NA', 3],
    ['CU', '192', 'Cuba', 'Cuba', 'NA', 3],
    ['DM', '212', 'Dominica', 'Dominica', 'NA', 4],
    ['DO', '214', 'Dominicaanse Republiek', 'Dominican Republic', 'NA', 2],
    ['SV', '222', 'El Salvador', 'El Salvador', 'NA', 3],
    ['GD', '308', 'Grenada', 'Grenada', 'NA', 4],
    ['GT', '320', 'Guatemala', 'Guatemala', 'NA', 3],
    ['HT', '332', 'Haïti', 'Haiti', 'NA', 5],
    ['HN', '340', 'Honduras', 'Honduras', 'NA', 4],
    ['JM', '388', 'Jamaica', 'Jamaica', 'NA', 3],
    ['MX', '484', 'Mexico', 'Mexico', 'NA', 2],
    ['NI', '558', 'Nicaragua', 'Nicaragua', 'NA', 4],
    ['PA', '591', 'Panama', 'Panama', 'NA', 3],
    ['KN', '659', 'Saint Kitts en Nevis', 'Saint Kitts and Nevis', 'NA', 4],
    ['LC', '662', 'Saint Lucia', 'Saint Lucia', 'NA', 3],
    ['VC', '670', 'Saint Vincent en de Grenadines', 'Saint Vincent and the Grenadines', 'NA', 4],
    ['TT', '780', 'Trinidad en Tobago', 'Trinidad and Tobago', 'NA', 3],
    ['US', '840', 'Verenigde Staten', 'United States', 'NA', 2],

    // South America
    ['AR', '032', 'Argentinië', 'Argentina', 'SA', 3],
    ['BO', '068', 'Bolivia', 'Bolivia', 'SA', 4],
    ['BR', '076', 'Brazilië', 'Brazil', 'SA', 3],
    ['CL', '152', 'Chili', 'Chile', 'SA', 3],
    ['CO', '170', 'Colombia', 'Colombia', 'SA', 3],
    ['EC', '218', 'Ecuador', 'Ecuador', 'SA', 3],
    ['GY', '328', 'Guyana', 'Guyana', 'SA', 4],
    ['PY', '600', 'Paraguay', 'Paraguay', 'SA', 4],
    ['PE', '604', 'Peru', 'Peru', 'SA', 3],
    ['SR', '740', 'Suriname', 'Suriname', 'SA', 2],
    ['UY', '858', 'Uruguay', 'Uruguay', 'SA', 3],
    ['VE', '862', 'Venezuela', 'Venezuela', 'SA', 5],

    // Oceania
    ['AU', '036', 'Australië', 'Australia', 'OC', 3],
    ['FJ', '242', 'Fiji', 'Fiji', 'OC', 4],
    ['KI', '296', 'Kiribati', 'Kiribati', 'OC', 5],
    ['MH', '584', 'Marshalleilanden', 'Marshall Islands', 'OC', 5],
    ['FM', '583', 'Micronesia', 'Micronesia', 'OC', 5],
    ['NR', '520', 'Nauru', 'Nauru', 'OC', 5],
    ['NZ', '554', 'Nieuw-Zeeland', 'New Zealand', 'OC', 3],
    ['PW', '585', 'Palau', 'Palau', 'OC', 5],
    ['PG', '598', 'Papoea-Nieuw-Guinea', 'Papua New Guinea', 'OC', 5],
    ['WS', '882', 'Samoa', 'Samoa', 'OC', 4],
    ['SB', '090', 'Salomonseilanden', 'Solomon Islands', 'OC', 5],
    ['TO', '776', 'Tonga', 'Tonga', 'OC', 4],
    ['TV', '798', 'Tuvalu', 'Tuvalu', 'OC', 5],
    ['VU', '548', 'Vanuatu', 'Vanuatu', 'OC', 4],
  ];

  // Player ranks, unlocked by total XP.
  var LEVELS = [
    { xp: 0, nl: 'Thuisblijver', en: 'Homebody' },
    { xp: 200, nl: 'Dagjesmens', en: 'Day Tripper' },
    { xp: 600, nl: 'Toerist', en: 'Tourist' },
    { xp: 1500, nl: 'Reiziger', en: 'Traveller' },
    { xp: 3000, nl: 'Avonturier', en: 'Adventurer' },
    { xp: 5500, nl: 'Globetrotter', en: 'Globetrotter' },
    { xp: 9000, nl: 'Wereldburger', en: 'World Citizen' },
    { xp: 14000, nl: 'Ontdekkingsreiziger', en: 'Explorer' },
    { xp: 22000, nl: 'Legende', en: 'Legend' },
    { xp: 40000, nl: 'Heeft Alles Gezien', en: 'Seen It All' },
  ];

  var COUNTRIES = RAW.map(function (r) {
    return { code: r[0], id: r[1], nl: r[2], en: r[3], continent: r[4], tier: r[5], xp: TIERS[r[5]].xp };
  });
  var BY_CODE = {};
  var BY_ID = {};
  COUNTRIES.forEach(function (c) {
    BY_CODE[c.code] = c;
    BY_ID[c.id] = c;
  });

  // Map shapes without an ISO id that belong to one of the 195.
  var EXTRA_SHAPES = { 'N. Cyprus': 'CY', Somaliland: 'SO' };

  // Everyone in the family lives here, so it always counts as visited.
  var HOME = 'NL';

  function xpFor(codes) {
    return codes.reduce(function (sum, code) {
      var c = BY_CODE[code];
      return sum + (c ? c.xp : 0);
    }, 0);
  }

  function levelFor(xp) {
    var idx = 0;
    for (var i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i].xp) idx = i;
    var next = LEVELS[idx + 1] || null;
    return { index: idx + 1, level: LEVELS[idx], next: next };
  }

  // ---------- badges ----------
  // Each badge counts how many of something you have (`have`) against a target (`need`).

  function inSet(codes) {
    return function (v) {
      return codes.filter(function (c) {
        return v.set[c];
      }).length;
    };
  }
  function ofTier(tier) {
    return function (v) {
      return v.list.filter(function (c) {
        return BY_CODE[c] && BY_CODE[c].tier === tier;
      }).length;
    };
  }
  function continentDone(k) {
    return function (v) {
      return v.list.filter(function (c) {
        return BY_CODE[c] && BY_CODE[c].continent === k;
      }).length;
    };
  }
  function continentSize(k) {
    return COUNTRIES.filter(function (c) {
      return c.continent === k;
    }).length;
  }
  var total = function (v) {
    return v.list.length;
  };

  var BADGES = [
    { id: 'first', icon: '✈️', need: 1, have: function (v) { return v.list.filter(function (c) { return c !== HOME; }).length; },
      nl: 'Eerste reis', en: 'First trip', dnl: 'Een land buiten Nederland', den: 'A country outside the Netherlands' },
    { id: 'neighbours', icon: '🤝', need: 2, have: inSet(['BE', 'DE']),
      nl: 'Goede buren', en: 'Good neighbours', dnl: 'België en Duitsland', den: 'Belgium and Germany' },
    { id: 'benelux', icon: '🧇', need: 3, have: inSet(['BE', 'NL', 'LU']),
      nl: 'Benelux', en: 'Benelux', dnl: 'België, Nederland en Luxemburg', den: 'Belgium, the Netherlands and Luxembourg' },
    { id: 'c10', icon: '🧳', need: 10, have: total, nl: '10 landen', en: '10 countries', dnl: 'Bezoek 10 landen', den: 'Visit 10 countries' },
    { id: 'c25', icon: '🌍', need: 25, have: total, nl: '25 landen', en: '25 countries', dnl: 'Bezoek 25 landen', den: 'Visit 25 countries' },
    { id: 'c50', icon: '🗺️', need: 50, have: total, nl: '50 landen', en: '50 countries', dnl: 'Bezoek 50 landen', den: 'Visit 50 countries' },
    { id: 'c100', icon: '💯', need: 100, have: total, nl: '100 landen', en: '100 countries', dnl: 'Bezoek 100 landen', den: 'Visit 100 countries' },
    { id: 'cont3', icon: '🧭', need: 3,
      have: function (v) { var s = {}; v.list.forEach(function (c) { if (BY_CODE[c]) s[BY_CODE[c].continent] = 1; }); return Object.keys(s).length; },
      nl: 'Drie werelddelen', en: 'Three continents', dnl: 'Landen in 3 werelddelen', den: 'Countries on 3 continents' },
    { id: 'cont6', icon: '🌐', need: 6,
      have: function (v) { var s = {}; v.list.forEach(function (c) { if (BY_CODE[c]) s[BY_CODE[c].continent] = 1; }); return Object.keys(s).length; },
      nl: 'Alle werelddelen', en: 'Every continent', dnl: 'Landen in alle 6 werelddelen', den: 'Countries on all 6 continents' },
    { id: 'nordic', icon: '❄️', need: 5, have: inSet(['DK', 'NO', 'SE', 'FI', 'IS']),
      nl: 'Noorderlicht', en: 'Northern lights', dnl: 'Alle Noordse landen', den: 'All Nordic countries' },
    { id: 'micro', icon: '🔬', need: 5, have: inSet(['VA', 'MC', 'SM', 'LI', 'AD']),
      nl: 'Mini-landen', en: 'Microstates', dnl: 'Vaticaan, Monaco, San Marino, Liechtenstein, Andorra', den: 'Vatican, Monaco, San Marino, Liechtenstein, Andorra' },
    { id: 'g7', icon: '💼', need: 7, have: inSet(['US', 'CA', 'GB', 'FR', 'DE', 'IT', 'JP']),
      nl: 'G7', en: 'G7', dnl: 'Alle G7-landen', den: 'All G7 countries' },
    { id: 'daredevil', icon: '🔥', need: 5, have: ofTier(4),
      nl: 'Durfal', en: 'Daredevil', dnl: '5 landen uit Tier 4', den: '5 Tier 4 countries' },
    { id: 'legend1', icon: '🐉', need: 1, have: ofTier(5),
      nl: 'Legendarisch', en: 'Legendary', dnl: 'Je eerste Tier 5-land', den: 'Your first Tier 5 country' },
    { id: 'legend5', icon: '👑', need: 5, have: ofTier(5),
      nl: 'Echte legende', en: 'True legend', dnl: '5 landen uit Tier 5', den: '5 Tier 5 countries' },
    { id: 'dreamer', icon: '⭐', need: 5, have: function (v) { return v.wish; },
      nl: 'Dromer', en: 'Dreamer', dnl: '5 landen op je wensenlijst', den: '5 countries on your wishlist' },
    { id: 'EU', icon: '🏰', need: continentSize('EU'), have: continentDone('EU'), nl: 'Heel Europa', en: 'All of Europe', dnl: 'Alle landen van Europa', den: 'Every country in Europe' },
    { id: 'AS', icon: '🏯', need: continentSize('AS'), have: continentDone('AS'), nl: 'Heel Azië', en: 'All of Asia', dnl: 'Alle landen van Azië', den: 'Every country in Asia' },
    { id: 'AF', icon: '🦁', need: continentSize('AF'), have: continentDone('AF'), nl: 'Heel Afrika', en: 'All of Africa', dnl: 'Alle landen van Afrika', den: 'Every country in Africa' },
    { id: 'NA', icon: '🗽', need: continentSize('NA'), have: continentDone('NA'), nl: 'Heel Noord-Amerika', en: 'All of North America', dnl: 'Alle landen van Noord-Amerika', den: 'Every country in North America' },
    { id: 'SA', icon: '🦙', need: continentSize('SA'), have: continentDone('SA'), nl: 'Heel Zuid-Amerika', en: 'All of South America', dnl: 'Alle landen van Zuid-Amerika', den: 'Every country in South America' },
    { id: 'OC', icon: '🏝️', need: continentSize('OC'), have: continentDone('OC'), nl: 'Heel Oceanië', en: 'All of Oceania', dnl: 'Alle landen van Oceanië', den: 'Every country in Oceania' },
  ];

  // Family XP, computed one way everywhere (dashboard and host page).
  // visitedLists: one array of visited country codes per family member.
  //  - xpSum:    every member's XP added up (a country counts once per person who visited it)
  //  - xpUnique: XP of the family's unique countries (each country counts once)
  function familyTotals(visitedLists) {
    var seen = {};
    var xpSum = 0;
    visitedLists.forEach(function (codes) {
      xpSum += xpFor(codes);
      codes.forEach(function (c) {
        if (BY_CODE[c]) seen[c] = 1;
      });
    });
    var unique = Object.keys(seen);
    return { xpSum: xpSum, xpUnique: xpFor(unique), countries: unique.length };
  }

  // visited: array of country codes; wish: number of wishlist entries.
  function badgesFor(visited, wish) {
    var set = {};
    visited.forEach(function (c) {
      set[c] = 1;
    });
    var v = { list: visited, set: set, wish: wish || 0 };
    return BADGES.map(function (b) {
      var have = Math.min(b.have(v), b.need);
      return { id: b.id, icon: b.icon, nl: b.nl, en: b.en, dnl: b.dnl, den: b.den, have: have, need: b.need, done: have >= b.need };
    });
  }

  var api = {
    TIERS: TIERS,
    CONTINENTS: CONTINENTS,
    COUNTRIES: COUNTRIES,
    LEVELS: LEVELS,
    BY_CODE: BY_CODE,
    BY_ID: BY_ID,
    EXTRA_SHAPES: EXTRA_SHAPES,
    HOME: HOME,
    MAX_XP: xpFor(Object.keys(BY_CODE)),
    xpFor: xpFor,
    levelFor: levelFor,
    BADGES: BADGES,
    badgesFor: badgesFor,
    familyTotals: familyTotals,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LANDEN = api;
})(this);
