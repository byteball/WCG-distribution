//exports.port = 6611;
//exports.myUrl = 'wss://mydomain.com/bb';
exports.bServeAsHub = false;
exports.bLight = true;
exports.bSingleAddress = true;

// Database
exports.storage = 'sqlite';

exports.bIgnoreUnpairRequests = true;
exports.hub = process.env.testnet ? 'obyte.org/bb-test' : 'obyte.org/bb';
exports.deviceName = 'WCG distribution';
exports.permanent_pairing_secret = '0000';
exports.control_addresses = [''];


exports.daysBetweenDistributions = 1;
exports.WCGpointToDollar = 0; // 1 / 1000000;
exports.labelAsset="WCG";
exports.prefixForName = "Obyte_";

exports.arrayInitialRewards = [
	{threshold: 1e5, rewardInDollars: 0.02},
	{threshold: 1e6, rewardInDollars: 0.3},
	{threshold: 10e6, rewardInDollars: 4},
	{threshold: 100e6, rewardInDollars: 15}
];

exports.teamId= "R1RD1XTFK92";
exports.bonusInPercentForUserInTeam = 10;
exports.maxDevices = 40;

exports.isMultiLingual = true;

exports.languagesAvailable = {
	en: {name: "English", file: "en"},
	da: {name: "Dansk", file: "wcg-bot_da-DK"},
	de: {name: "Deutsch", file: "wcg-bot_de-DE"},
	el: {name: "Ελληνικά", file: "wcg-bot_el-GR"},
	es: {name: "Español", file: "wcg-bot_es-ES"},
	et: {name: "Eesti", file: "wcg-bot_et-EE"},
	fr: {name: "Français", file: "wcg-bot_fr-FR"},
	hi: {name: "हिन्दी", file: "wcg-bot_hi-IN"},
	hu: {name: "Magyar", file: "wcg-bot_hu-hu"},
	id: {name: "Bahasa Indonesia", file: "wcg-bot_id-ID"},
	it: {name: "Italiano", file: "wcg-bot_it-IT"},
	ja: {name: "日本語", file: "wcg-bot_ja-JP"},
	ko: {name: "한국어", file: "wcg-bot_ko-KR"},
	nl: {name: "Nederlands", file: "wcg-bot_nl-NL"},
	pl: {name: "Polski", file: "wcg-bot_pl-PL"},
	ru: {name: "Русский", file: "wcg-bot_ru-RU"},
	tl: {name: "Tagalog", file: "wcg-bot_tl-PH"},
	uk: {name: "Українська", file: "wcg-bot_uk-UA"},
	vi: {name: "Tiếng Việt", file: "wcg-bot_vi-VN"},
	yo: {name: "Yorùbá", file: "wcg-bot_yo-NG"},
	zh: {name: "中文", file: "wcg-bot_zh-CN"}
};

console.log('finished WCG bot conf');