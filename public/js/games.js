const PLATFORM_LABEL = {
  mobile: "移动端",
  pc: "PC端",
  arcade: "街机",
};

const PLATFORM_ALIAS = {
  mobile: ["手机", "手游", "移动"],
  pc: ["电脑", "steam", "桌面"],
  arcade: ["街机", "机厅", "cabinet"],
};

const GAMES = [
  { name: "Arcaea", alias: "低音部 / Arcaea", platforms: ["mobile"], codeLabel: "好友ID", servers: ["国际服", "国服"], note: "网络功能 - 添加，输入对方 9 位好友ID（单向关注）。移动端 iOS/Android，另有 Switch 版。" },
  { name: "Cytus II", alias: "Cytus II / 音律cytus2", platforms: ["mobile"], codeLabel: "好友码", servers: ["国际服", "国服"], note: "社区内通过好友码互加。" },
  { name: "Rotaeno", alias: "旋转音律", platforms: ["mobile"], codeLabel: "好友码", servers: ["国服", "国际服"], note: "移动端音游，支持好友码互加。" },
  { name: "Project SEKAI", alias: "世界计划 / プロジェクトセカイ / 缤纷舞台 / PJSK", platforms: ["mobile"], codeLabel: "好友码", servers: ["日服", "国际服", "国服", "台服"], note: "设置 - 好友 - 输入好友码（各服数据不互通，需对应服互加）。" },
  { name: "D4DJ Groovy Mix", alias: "电音派对 / グルミク", platforms: ["mobile"], codeLabel: "好友", servers: ["日服", "国际服", "国服"], note: "通过好友搜索添加。" },
  { name: "BanG Dream! 少女乐队派对", alias: "Garupa / 邦邦 / 女bang", platforms: ["mobile"], codeLabel: "好友", servers: ["日服", "国际服", "国服"], note: "通过 ID / 昵称搜索好友。国服为 B服（bilibili 代理）。" },
  { name: "BanG Dream! Our Notes", alias: "交织的乐章 / 我们的音符 / OUR NOTE / アワーノーツ", platforms: ["mobile"], codeLabel: "好友", servers: ["日服", "国际服", "港台服"], note: "BanG Dream 系列新作音游。港澳台共用一个服务器（繁中服）。" },
  { name: "Love Live! 学园偶像祭", alias: "SIF / 学园偶像祭 / 璀璨城市", platforms: ["mobile"], codeLabel: "好友ID", servers: ["日服", "国际服", "国服"], note: "好友ID 互加。" },
  { name: "Ensemble Stars!!", alias: "偶像梦幻祭 / あんスタ", platforms: ["mobile"], codeLabel: "好友", servers: ["日服", "国际服"], note: "好友添加。" },
  { name: "节奏大师", alias: "Rhythm Master / 节奏大师", platforms: ["mobile"], codeLabel: "好友(QQ/微信)", servers: ["国服"], note: "通过 QQ / 微信直接加好友。" },
  { name: "osu!", alias: "osu! / 圈圈", platforms: ["pc"], codeLabel: "好友", servers: ["国际服"], note: "内置好友系统，搜索用户名即可添加。" },
  { name: "beatmania IIDX INFINITAS", alias: "IIDX / 狂热节拍 / INFINITAS", platforms: ["pc", "arcade"], codeLabel: "对手码(Rival)", servers: ["日服"], note: "e-AMUSEMENT 对手码(Rival)互加，PC(INFINITAS) 与街机同体系。" },
  { name: "SOUND VOLTEX ∇", alias: "SDVX / 声波突击 / NABLA / EXCEED GEAR 的后续第七代", platforms: ["pc", "arcade"], codeLabel: "对手码(Rival)", servers: ["日服"], note: "e-AMUSEMENT 对手码(Rival)互加，PC(konasute) 与街机同体系。最新机种为第七代 ∇(NABLA)。" },
  { name: "白金档案 PLATiNA :: LAB", alias: "platina lab / 白金档案 / 萌娘下落式音游", platforms: ["pc"], codeLabel: "好友", servers: ["国服"], note: "PC 下落式音游（2026 发售），游戏内好友系统互加。" },
  { name: "maimai DX", alias: "舞萌DX / 舞萌 / maimai", platforms: ["arcade"], codeLabel: "好友码", servers: ["日服", "国服"], note: "网络 - 好友 - 输入好友码（日服/国服数据不互通）。" },
  { name: "CHUNITHM", alias: "中二节奏 / チュウニズム / chuni", platforms: ["arcade"], codeLabel: "好友码", servers: ["日服", "国服"], note: "好友 - 输入好友码。" },
  { name: "ongeki", alias: "音击 / オンゲキ", platforms: ["arcade"], codeLabel: "好友码", servers: ["日服", "国服"], note: "好友 - 输入好友码。" },
  { name: "WACCA", alias: "WACCA / 瓦卡", platforms: ["arcade"], codeLabel: "好友码", servers: ["日服"], note: "好友码互加。" },
  { name: "Groove Coaster", alias: "groove闯关 / GC / 音浪狂飙", platforms: ["arcade", "pc"], codeLabel: "好友码", servers: ["日服"], note: "e-AMUSEMENT 好友（街机 / Steam 版）。" },
  { name: "太鼓の達人", alias: "太鼓达人 / 太鼓之达人 / 咚咔", platforms: ["arcade"], codeLabel: "好友/对手码", servers: ["日服", "国服"], note: "网络对战 / 好友。" },
  { name: "pop'n music", alias: "流行音乐 / ポップン", platforms: ["arcade"], codeLabel: "对手码(Rival)", servers: ["日服"], note: "e-AMUSEMENT 对手码。" },
  { name: "GITADORA", alias: "吉他/鼓 mania / 共鸣火花", platforms: ["arcade"], codeLabel: "对手码(Rival)", servers: ["日服"], note: "e-AMUSEMENT 对手码。" },
];

function findGame(name) {
  return GAMES.find((g) => g.name === name) || null;
}

function allServers() {
  const set = new Set();
  GAMES.forEach((g) => g.servers.forEach((s) => set.add(s)));
  return Array.from(set);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { GAMES, PLATFORM_LABEL, findGame, allServers };
