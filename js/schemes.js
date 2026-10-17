// 客變方案：只動戶內非承重隔間、門位與家具，不動柱梁、分戶牆、外牆與窗、陽台、管道間，濕區不移位
// 每個方案在 plan.js 套到樣板的複本上（左上象限座標，公尺），其餘戶鏡射套用
// 採光檢討：建築技術規則設計施工編第 41 條，居室採光面積 ≥ 樓地板面積 1/8；窗高：一般窗 1.3m、落地門 2.35m

const sameO = (a, b) => a.o === b.o && Math.abs(a.at - b.at) < 0.01 && Math.abs(a.c - b.c) < 0.01;
const dropOpening = (t, o) => { t.openings = t.openings.filter(x => !sameO(x, o)); };
const dropF = (t, ...preds) => { t.furniture = t.furniture.filter(f => !preds.some(p => p(f))); };
const at = (name, x, y, r = 0.05) => f => f.f === name && Math.abs(f.x - x) < r && Math.abs(f.y - y) < r;
const room = (t, sp, patch) => t.rooms.filter(r => r.sp === sp).forEach(r => Object.assign(r, patch));

export const SCHEMES = {
  corner: [
    {
      id: 'c0', name: '建商原始', tag: '3房2廳2衛',
      summary: '計畫書圖 9-27 的原始隔間。',
      apply() {},
    },
    {
      id: 'c1', name: '餐廚一體', tag: '3房・開放廚房',
      summary: '拆掉廚房與餐廳之間的隔間，廚房西窗的光直接進到餐廳，做菜時也能跟家人說話。房間數不變。',
      changes: ['拆除廚房東側整道隔間', '廚具位置、水槽、排油煙路徑不動', '爐具改 IH 感應爐（建材表：開放式廚房配 IH）'],
      comfort: ['餐廳多一道自然光，白天不用開燈', '冰箱、餐桌、水槽三點連成一線，備餐少走路', '可另加玻璃拉門，炒菜時拉起來擋油煙'],
      legal: ['不動結構、管道間、外牆與窗', '廚房仍有對外窗，排油煙機原管路排出', '拆牆後偵煙器由建商依消防法規調整'],
      apply(t) {
        t.label = '3房2廳2衛・開放廚房';
        t.openings.push({ o: 'v', at: 4.2, c: 7.66, w: 1.7, k: 'open', full: 1 });
        dropOpening(t, { o: 'v', at: 4.2, c: 7.85 });
        // 餐桌移近廚房：長向沿東西、靠廚房開口
        dropF(t, at('dining', 6.9, 6.3), at('pendant', 6.9, 6.3));
        t.furniture.push({ f: 'dining', x: 6.3, y: 7.35, face: 'down', a: [1.6, 0.85] }, { f: 'pendant', x: 6.3, y: 7.35 });
      },
    },
    {
      id: 'c2', name: '書房客廳', tag: '2房＋開放書房',
      summary: '靠客廳的次臥改成書房，與客廳之間換成玻璃隔間＋拉門。客廳多一扇北窗的景，拉上窗簾就是客房。',
      changes: ['次臥改書房：取消原房門，牆面做整面書櫃', '書房與客廳之間改強化玻璃隔間＋玻璃拉門', '電視牆移到東側分戶牆，沙發背靠玻璃'],
      comfort: ['客廳視野從 2.6m 加寬到兩扇窗，空間感大很多', '書桌在北窗下，光線均勻不刺眼', '書房放沙發床，客人來可關門過夜'],
      legal: ['書房 7.8㎡，北窗 1.82㎡ ≥ 1/8（0.98㎡）', '客廳採光 6.1㎡ ≥ 1/8（3.8㎡）', '玻璃用強化或膠合安全玻璃；偵煙器、灑水頭依新隔間調整'],
      apply(t) {
        t.label = '2房＋書房・2廳2衛';
        room(t, 'b1', { t: '書房' });
        dropOpening(t, { o: 'h', at: 3.9, c: 4.75 });
        t.openings.push({ o: 'v', at: 5.3, c: 2.3, w: 0.8, k: 'open' }, { o: 'v', at: 5.3, c: 3.3, w: 1.05, k: 'glass', leaf: 1 });
        dropF(t, f => f.y < 3.95 && f.x > 2.95 && f.x < 5.3,                               // 原次臥家具
          at('sofa', 8.1, 3.6), at('tvUnit', 5.5, 2.9), at('art', 8.53, 3.6), at('rug', 7.1, 3.6), at('coffeeTable', 7.1, 3.6), at('floorLamp', 8.3, 5.0));
        t.furniture.push(
          { f: 'desk', x: 4.1, y: 0.92, face: 'down', a: [1.3] },
          { f: 'bookshelf', x: 3.1, y: 2.3, face: 'right', a: [2.2] },
          { f: 'sofa', x: 4.25, y: 3.45, face: 'up', a: [1.8] },                           // 沙發床
          { f: 'plant', x: 5.0, y: 0.95 },
          { f: 'rug', x: 7.05, y: 3.75, face: 'right', a: [2.2, 1.7] },
          { f: 'sofa', x: 5.85, y: 3.75, face: 'right', a: [2.1] },             // 沙發背靠玻璃，不擋書房入口
          { f: 'coffeeTable', x: 7.0, y: 3.75, face: 'right' },
          { f: 'tvUnit', x: 8.35, y: 3.75, face: 'left', a: [1.8] },
        );
      },
    },
    {
      id: 'c3', name: '主臥套房', tag: '2房・主臥更衣室',
      summary: '次臥併給主臥當更衣室，衣服全部收進去，主臥只留床和窗，睡眠空間變得乾淨安靜。',
      changes: ['次臥改更衣室，從主臥開門進出，取消原房門', '主臥原衣櫃移到更衣室，空出床尾做書桌', '更衣室北窗下放梳妝台'],
      comfort: ['兩面牆共 4.4m 衣櫃，一家人的衣物都收得下', '主臥床尾到書桌還有約 1.6m，不再擠', '更衣與睡眠分開，早起換衣服不吵到另一半'],
      legal: ['不動結構、管道間、外牆與窗', '更衣室屬儲藏空間，保留原窗通風', '偵煙器依新隔間調整'],
      apply(t) {
        t.label = '2房2廳2衛＋更衣室';
        room(t, 'b1', { t: '更衣室' });
        dropOpening(t, { o: 'h', at: 3.9, c: 4.75 });
        t.openings.push({ o: 'v', at: 2.95, c: 3.35, w: 0.85, k: 'open' });
        dropF(t, f => f.y < 3.95 && f.x > 2.95 && f.x < 5.3, at('wardrobe', 1.2, 4.65));
        t.furniture.push(
          { f: 'wardrobe', x: 3.25, y: 1.75, face: 'right', a: [2.0, true] },
          { f: 'wardrobe', x: 5.0, y: 2.25, face: 'left', a: [2.4, true] },
          { f: 'dresser', x: 4.15, y: 0.9, face: 'down', a: [0.95] },
          { f: 'desk', x: 1.0, y: 4.65, face: 'up', a: [1.2] },
        );
      },
    },
    {
      id: 'c4', name: '中島廚房＋家事間', tag: '格局重整・3房＋家事間',
      summary: '廚房從西側搬到原本的走道和餐廳區，改成面向客廳的中島廚房；原廚房有西窗，改成家事間，放冰箱、儲藏，也是通往工作陽台的動線。那條 1.4m 寬、只用來走路的走道就此消失。',
      changes: ['廚房移到中央：一字檯面靠主浴外牆，前方 2.2m 中島兼餐桌', '水槽緊鄰主浴管道間（排水不到 1m），爐具改 IH', '原廚房改家事間：冰箱、儲藏高櫃、洗烘塔、摺衣檯，從廚房旁的門進、通工作陽台', '主浴、客浴、三間臥室、玄關都不動'],
      comfort: ['做菜面向客廳和餐桌，不再背對家人關在小廚房', '原本約 6㎡ 的走道大半變成廚房：同樣坪數多了 2.2m 中島檯面和 4 張吧台椅', '洗、烘、摺、收都在家事間一次完成，天氣好再拿去工作陽台曬；工作陽台只留熱水器、洗衣槽、曬衣', '原廚房的西窗留給家事間，曬衣、晾乾的濕氣不會進客廳'],
      legal: ['廚房不屬居室，不受採光規定限制；排油煙機風管走天花到外牆（建商評估路徑）', '家事間放洗衣機需做防水與地排、接工作陽台排水；熱泵烘衣機免排氣管', '瓦斯熱水器留在工作陽台（戶外通風）；工作陽台不得加窗或外推', '水槽靠既有管道間；不動柱梁、分戶牆、外牆與窗、陽台', '中央廚房改 IH，無明火；偵熱、灑水頭依新配置調整', '戶數、主建物面積不變'],
      apply(t) {
        t.label = '3房2廳2衛＋家事間';
        room(t, 'kit', { t: '家事間', r: [0, 6.75, 3.9, 8.565] });
        t.rooms.push({ t: '廚房', sp: 'kit2', r: [3.9, 4.95, 5.27, 8.565] });
        dropOpening(t, { o: 'v', at: 4.2, c: 7.85 });
        t.openings.push(
          { o: 'v', at: 3.9, c: 8.1, w: 0.8, k: 'door', sw: -1, hg: 1 },          // 廚房 → 家事間
          { o: 'v', at: 5.27, c: 6.725, w: 3.55, k: 'open', full: 1 },              // 中島廚房對客餐廳全開
          { o: 'h', at: 4.95, c: 4.585, w: 1.37, k: 'open', full: 1 },
        );
        dropF(t, at('kitchen', 2.3, 7.05), at('fridge', 0.38, 8.1), at('dining', 6.9, 6.3), at('pendant', 6.9, 6.3), at('washer', 1.69, 10.95));
        t.furniture.push(
          { f: 'kitchen', x: 4.2, y: 6.3, face: 'right', a: [2.7] },
          { f: 'island', x: 6.05, y: 6.4, face: 'right', a: [2.2] },
          { f: 'pendant', x: 6.05, y: 5.9 }, { f: 'pendant', x: 6.05, y: 6.9 },
          // 家事間（室內、乾）：冰箱、儲藏高櫃、洗烘塔、摺衣檯；工作陽台（戶外、濕）：熱水器、洗衣槽、曬衣
          { f: 'fridge', x: 3.45, y: 7.15, face: 'left' },
          { f: 'wardrobe', x: 1.7, y: 7.05, face: 'down', a: [1.5, true] },
          { f: 'washerDryer', x: 0.4, y: 8.2, face: 'right' },
          { f: 'foldTable', x: 0.33, y: 7.2, face: 'right', a: [0.8] },
          { f: 'plant', x: 8.2, y: 6.2 },
        );
      },
    },
    {
      id: 'c5', name: '全配版', tag: '開放廚房＋中島・書房・雙衛乾濕分離',
      summary: '以「中島廚房＋家事間」為底：開放式廚房＋中島、電器櫃、洗碗機；東牆一整排展示櫃、咖啡吧台（冷飲小冰箱）、髒衣外套櫃；玄關鞋櫃＋穿鞋凳；L 沙發；主臥隔出更衣化妝間；書房；主衛乾濕分離四件套、客衛乾濕分離三件套。',
      changes: ['廚房：北端 90cm 電器櫃（烤箱、微波爐、氣炸鍋、電鍋、電子鍋，抽拉層板散蒸氣），一字檯面含水槽、IH、洗碗機，前方 2.2m 中島', '東側分戶牆一字排開：展示櫃 → 咖啡吧台（冷飲小冰箱、咖啡機、杯架）→ 髒衣外套櫃', '玄關：整面鞋櫃，一半是附穿衣鏡的整櫃，一半挖空成穿鞋凳（凳下放室內拖）', '客廳：L 沙發，貴妃椅朝電視', '主臥南段隔出更衣化妝間：1.4m 衣櫃＋化妝台，從主臥入口穿過更衣間進臥室', '書房（北側次臥）；主衛乾濕分離四件套；客衛乾濕分離三件套；原廚房改家事間'],
      comfort: ['電器全部收進高櫃，檯面淨空；電鍋、電子鍋在抽拉層板上，蒸氣不悶在櫃裡', '洗碗機在水槽旁，碗盤沖完直接放', '咖啡吧台在餐區旁，倒飲料不用進廚房；冷飲冰箱和主冰箱分開', '進門：坐鞋櫃凳換鞋、照鏡子 → 外套、包包掛外套櫃（百葉門通風），外面的髒污不進房間；玄關仍留近 1m 寬走道', '主臥：臥室只放床，換衣、化妝在更衣間，早起不吵另一半', '主衛淋浴、泡澡在濕區，乾區地面隨時是乾的'],
      legal: ['馬桶都在管道間 1m 內，浴缸、淋浴排水走原管道間', '主衛保留西側高窗通風，客衛維持機械排風（建材表：當層排氣）', '書房 7.8㎡，北窗 1.82㎡ ≥ 1/8；主臥縮成 8.8㎡，西窗 2.08㎡ ≥ 1/8', '浴室玻璃用強化或膠合安全玻璃；廚房 IH；電器櫃、咖啡吧台需各自專用迴路（烤箱、洗碗機、微波爐不可共用）', '偵煙、灑水依新隔間調整'],
      apply(t) {
        schemeById('c4').apply(t);
        t.label = '2房＋書房・2廳2衛＋家事間＋更衣間';
        // 廚房：電器櫃＋一字檯面（水槽、IH、洗碗機）
        dropF(t, at('kitchen', 4.2, 6.3));
        t.furniture.push({ f: 'applianceTower', x: 4.2, y: 5.47, face: 'right', a: [0.9] }, { f: 'kitchen', x: 4.2, y: 6.84, face: 'right', a: [1.8, true] });
        // 東側分戶牆：展示櫃 → 咖啡吧台 → 髒衣外套櫃；L 沙發
        dropF(t, at('floorLamp', 8.3, 5.0), at('plant', 8.2, 6.2), at('plant', 8.25, 2.15), at('shoeCabinet', 8.36, 7.6), at('sofa', 8.1, 3.6), at('coffeeTable', 7.1, 3.6), at('rug', 7.1, 3.6));
        t.furniture.push(
          { f: 'displayCabinet', x: 8.35, y: 5.4, face: 'left', a: [1.0] },
          { f: 'coffeeBar', x: 8.26, y: 6.6, face: 'left', a: [1.4] },
          { f: 'coatCloset', x: 8.26, y: 7.85, face: 'left', a: [1.0] },
          { f: 'rug', x: 7.1, y: 3.35, face: 'left', a: [2.2, 1.7] },
          { f: 'sofaL', x: 8.1, y: 3.55, face: 'left', a: [2.5, 1.6] },
          { f: 'coffeeTable', x: 7.0, y: 3.2, face: 'left' },
        );
        // 玄關：鞋櫃、穿鞋凳
        t.furniture.push({ f: 'shoeBench', x: 8.36, y: 9.05, face: 'left', a: [1.05] });
        // 主臥南段隔出更衣化妝間（主臥入口 → 更衣間 → 臥室）
        t.rooms.find(r => r.sp === 'mb' && r.r[0] === 0).r = [0, 0.615, 2.95, 3.6];
        t.rooms.push({ t: '更衣間', sp: 'dress', r: [0, 3.6, 2.95, 4.95] });
        t.openings.push({ o: 'h', at: 3.6, c: 2.35, w: 1.0, k: 'open' }, { o: 'v', at: 2.95, c: 4.42, w: 0.95, k: 'open' });
        dropF(t, at('wardrobe', 1.2, 4.65));
        t.furniture.push({ f: 'wardrobe', x: 1.57, y: 4.65, face: 'up', a: [1.36, true] }, { f: 'dresser', x: 0.25, y: 4.05, face: 'right', a: [0.9] });
        // 書房
        room(t, 'b1', { t: '書房' });
        dropF(t, f => f.y < 3.95 && f.x > 2.95 && f.x < 5.3);
        t.furniture.push({ f: 'desk', x: 4.1, y: 0.92, face: 'down', a: [1.3] }, { f: 'bookshelf', x: 3.1, y: 2.3, face: 'right', a: [2.2] }, { f: 'plant', x: 3.3, y: 3.6 }, { f: 'floorLamp', x: 5.0, y: 1.0 });
        // 主衛四件套：西側濕區（浴缸＋淋浴）、東側乾區（面盆＋馬桶）
        room(t, 'mbath', { r: [1.75, 4.95, 3.9, 6.75] });
        t.rooms.push({ t: '主浴濕區', sp: 'mbath2', r: [0, 4.95, 1.75, 6.75] });
        t.openings.push({ o: 'v', at: 1.75, c: 5.45, w: 0.96, k: 'glass' }, { o: 'v', at: 1.75, c: 6.35, w: 0.76, k: 'open' });
        dropF(t, at('tub', 0.4, 5.85), at('vanity', 1.6, 5.2), at('toilet', 2.5, 6.4));
        t.furniture.push(
          { f: 'tub', x: 0.4, y: 5.85, face: 'right' },
          { f: 'rainShower', x: 1.28, y: 5.0, face: 'down' },
          { f: 'vanity', x: 2.4, y: 5.2, face: 'down', a: [1.1] },
          { f: 'toilet', x: 3.6, y: 6.25, face: 'left' },
        );
        // 客衛三件套：南端淋浴濕區、北側乾區
        room(t, 'bath', { r: [5.27, 8.5, 7.2, 10.25] });
        t.rooms.push({ t: '客浴濕區', sp: 'bath2', r: [5.27, 10.25, 7.2, 11.3] });
        t.openings.push({ o: 'h', at: 10.25, c: 5.85, w: 1.12, k: 'glass' }, { o: 'h', at: 10.25, c: 6.8, w: 0.72, k: 'open' });
        dropF(t, at('toilet', 6.6, 10.95), at('vanity', 5.52, 9.4), at('shower', 5.75, 10.8));
        t.furniture.push(
          { f: 'vanity', x: 5.52, y: 9.5, face: 'right', a: [0.9] },
          { f: 'toilet', x: 6.88, y: 9.6, face: 'left' },
          { f: 'rainShower', x: 6.2, y: 11.25, face: 'up' },
        );
      },
    },
  ],
  mid: [
    {
      id: 'm0', name: '建商原始', tag: '2房2廳2衛',
      summary: '計畫書圖 9-27 的原始隔間。',
      apply() {},
    },
    {
      id: 'm1', name: '彈性書房', tag: '2房・玻璃書房',
      summary: '次臥靠客廳那面牆，一半換成玻璃隔間加開口。客廳寬度只有 2.95m，加上書房後視線可以穿過去，不會覺得壓迫。',
      changes: ['次臥改書房，入口改從客廳進，取消走道上的房門', '書房與客廳之間：電視牆保留，其餘改玻璃隔間＋開口', '書房放書桌、書櫃、沙發床'],
      comfort: ['坐在沙發上視線穿過書房看到陽台，橫向空間感多了 2.6m', '在家工作有獨立角落，又看得到客廳的小孩', '客人來時拉上窗簾就是客房'],
      legal: ['書房 7.5㎡，窗 1.82㎡ ≥ 1/8（0.94㎡）', '不動結構、管道間、外牆與窗', '玻璃用安全玻璃；偵煙器、灑水頭依新隔間調整'],
      apply(t) {
        t.label = '1房＋書房・2廳2衛';
        room(t, 'b1', { t: '書房' });
        dropOpening(t, { o: 'h', at: 4.15, c: 13.5 });
        t.openings.push({ o: 'v', at: 11.5, c: 2.95, w: 0.75, k: 'glass', leaf: 0 }, { o: 'v', at: 11.5, c: 3.73, w: 0.8, k: 'open' });
        dropF(t, f => f.x > 11.5 && f.x < 14.1 && f.y > 1.24 && f.y < 4.15, at('tvUnit', 11.3, 2.5));
        t.furniture.push(
          { f: 'tvUnit', x: 11.3, y: 1.88, face: 'left', a: [1.2] },
          { f: 'desk', x: 12.45, y: 1.55, face: 'down', a: [1.1] },
          { f: 'sofa', x: 13.65, y: 3.2, face: 'left', a: [1.8] },               // 沙發床靠東牆
          { f: 'bookshelf', x: 12.4, y: 3.98, face: 'up', a: [1.4] },
        );
      },
    },
    {
      id: 'm2', name: '一房大客廳', tag: '1房・大客廳',
      summary: '給兩人或單身住：拆掉次臥，客廳從 2.95m 寬變成 5.5m，餐桌、沙發、工作桌都放得下，兩扇窗一起採光。',
      changes: ['拆除次臥與客廳、走道之間的隔間', '客廳改東西向配置：電視靠主臥牆、沙發面向東', '原次臥窗下做工作桌'],
      comfort: ['客廳寬 5.5m，沙發到電視約 2.7m，看電視不累', '兩扇窗＋落地門同時採光，白天整個公共區都亮', '餐桌留在廚房旁，客餐廳動線分開'],
      legal: ['客餐廳約 34㎡（含走道、玄關），採光約 7.0㎡ ≥ 1/8（4.3㎡）', '戶數、主建物面積不變，一般不涉及都更事業計畫變更', '偵煙器依新空間調整；之後要隔回房間仍可施作'],
      apply(t) {
        t.label = '1房2廳2衛';
        room(t, 'b1', { t: '客餐廳', sp: 'pub' });
        dropOpening(t, { o: 'h', at: 4.15, c: 13.5 });
        dropF(t, f => f.x > 11.5 && f.x < 14.1 && f.y > 1.24 && f.y < 4.15,
          at('tvUnit', 11.3, 2.5), at('sofa', 9.0, 2.1), at('rug', 9.9, 2.1), at('coffeeTable', 9.95, 2.1), at('art', 8.57, 2.1), at('plant', 8.95, 0.4));
        t.furniture.push(
          { f: 'rug', x: 12.1, y: 3.0, face: 'right', a: [2.2, 1.7] },
          { f: 'sofa', x: 10.75, y: 3.0, face: 'right', a: [2.2] },
          { f: 'coffeeTable', x: 12.1, y: 3.0, face: 'right' },
          { f: 'tvUnit', x: 13.88, y: 3.1, face: 'left', a: [1.8] },
          { f: 'desk', x: 12.95, y: 1.55, face: 'down', a: [1.2] },
          { f: 'bookshelf', x: 8.78, y: 1.25, face: 'right', a: [1.6] },
          { f: 'floorLamp', x: 9.95, y: 0.5 },
          { f: 'plant', x: 8.95, y: 2.45 },
        );
      },
    },
    {
      id: 'm3', name: '入口廚房', tag: '格局重整・2房',
      summary: '原本 3m 長的玄關走道只用來穿鞋，客廳卻要和廚房、冰箱擠在同一條 2.95m 寬的長條裡。把廚房搬進玄關，客餐廳整條留給沙發、電視和四人餐桌。',
      changes: ['廚房移到玄關：一字檯面靠西牆，對客餐廳全開', '冰箱移到廚房與餐廳交界，鞋櫃改放門邊', '客餐廳：北段客廳、南段四人餐桌，中間不再有廚具', '兩間臥室、兩間浴室不動'],
      comfort: ['客廳不再有冰箱貼著沙發，看電視、聊天的區域完整', '餐桌從 1 人座變成 4 人座，就在廚房出口', '買菜進門直接放廚房，不必穿過客廳', '浪費的 5㎡ 走道變成廚房，等於客餐廳淨多 5㎡'],
      legal: ['廚房不屬居室；排油煙風管走天花到外牆，水槽排水需建商評估坡度（原廚房同樣不靠管道間）', '大門位置、防火門不動；不動柱梁、分戶牆、外牆與窗', '廚房改 IH；偵熱、灑水頭依新配置調整', '戶數、主建物面積不變'],
      apply(t) {
        t.label = '2房2廳2衛・入口廚房';
        t.rooms.filter(r => r.t === '玄關').forEach(r => { r.t = '廚房'; r.sp = 'kit'; });
        t.openings.push({ o: 'h', at: 6.65, c: 9.425, w: 1.75, k: 'open', full: 1 });
        dropF(t, at('kitchen', 8.85, 5.3), at('fridge', 8.93, 3.65), at('dining', 11.12, 5.6), at('pendant', 11.12, 5.6), at('shoeCabinet', 10.11, 7.8));
        t.furniture.push(
          { f: 'kitchen', x: 8.85, y: 7.65, face: 'right', a: [1.8] },
          { f: 'fridge', x: 8.93, y: 6.2, face: 'right' },
          { f: 'shoeCabinet', x: 10.11, y: 9.0, face: 'left', a: [0.8] },
          { f: 'dining', x: 10.05, y: 4.9, face: 'down', a: [1.4, 0.8] },
          { f: 'pendant', x: 10.05, y: 4.9 },
          { f: 'floorLamp', x: 9.0, y: 3.6 },
        );
      },
    },
    {
      id: 'm4', name: '全配版', tag: '開放廚房＋中島・書房・雙衛乾濕分離',
      summary: '中間戶塞進同樣的需求：廚房搬進玄關、客餐廳交界放中島；次臥改玻璃書房；主衛向主臥入口借一段，做成乾濕分離四件套；客衛改乾濕分離三件套。代價是只剩一間臥室。',
      changes: ['開放式廚房在原玄關，客餐廳交界放 1.2m 中島（兼兩人餐桌）', '書房：次臥改玻璃書房，從客廳進', '主衛擴大到約 6㎡：東側濕區（淋浴＋浴缸）玻璃隔開，乾區面盆、馬桶；主臥入口走道縮成 0.8m', '客衛 2.6×1.75m：西側淋浴濕區玻璃隔開，門改到東側', '主臥衣櫃改推拉門，讓出主衛入口'],
      comfort: ['主衛有浴缸，泡澡、淋浴分開，乾區保持乾燥', '客衛乾濕分離，客人用完地板不濕', '中島讓 2.95m 寬的客廳不用再塞餐桌', '書房玻璃隔間，客廳看得穿、不壓迫'],
      legal: ['兩間馬桶都在管道間 1m 內；主衛浴缸排水需建商確認坡度', '書房 7.5㎡，窗 1.82㎡ ≥ 1/8', '浴室玻璃用安全玻璃；廚房 IH；偵煙、灑水依新隔間調整', '只剩 1 房：戶數、主建物面積不變，但轉售時房數少要考量'],
      apply(t) {
        schemeById('m3').apply(t);
        schemeById('m1').apply(t);
        t.label = '1房＋書房・2廳2衛';
        // 中島：冰箱移到客廳西牆，中島放在客餐廳和廚房交界
        dropF(t, at('fridge', 8.93, 6.2), at('dining', 10.05, 4.9), at('pendant', 10.05, 4.9));
        t.furniture.push({ f: 'fridge', x: 8.93, y: 4.6, face: 'right' }, { f: 'island', x: 10.15, y: 5.45, face: 'up', a: [1.2] }, { f: 'pendant', x: 9.85, y: 5.4 }, { f: 'pendant', x: 10.45, y: 5.4 });
        // 主衛四件套
        t.rooms.find(r => r.sp === 'mb' && r.r[1] === 4.15).r = [14.1, 4.15, 14.9, 4.9];
        room(t, 'mbath', { r: [14.1, 4.9, 15.6, 6.65] });
        t.rooms.push({ t: '主浴', sp: 'mbath', r: [14.9, 4.15, 15.6, 4.9] }, { t: '主浴濕區', sp: 'mbath2', r: [15.6, 4.15, 16.8, 6.65] });
        dropOpening(t, { o: 'h', at: 4.9, c: 16.2 });
        t.openings.push(
          { o: 'v', at: 14.9, c: 4.525, w: 0.7, k: 'door', sw: 1, hg: -1 },
          { o: 'v', at: 15.6, c: 4.6, w: 0.7, k: 'open' }, { o: 'v', at: 15.6, c: 5.8, w: 1.64, k: 'glass' },
        );
        dropF(t, at('vanity', 15.4, 5.15), at('toilet', 15.95, 6.3), at('shower', 14.56, 5.76), at('wardrobe', 14.92, 3.86));
        t.furniture.push(
          { f: 'toilet', x: 14.45, y: 6.3, face: 'up' },
          { f: 'vanity', x: 15.2, y: 6.4, face: 'up', a: [0.7] },
          { f: 'rainShower', x: 16.2, y: 4.2, face: 'down' },
          { f: 'tub', x: 16.4, y: 5.85, face: 'left' },
          { f: 'wardrobe', x: 16.15, y: 3.86, face: 'up', a: [1.2, true] },
        );
        // 客衛三件套：西側淋浴濕區，門移到東側
        room(t, 'bath', { r: [12.4, 4.9, 14.1, 6.65] });
        t.rooms.push({ t: '客浴濕區', sp: 'bath2', r: [11.5, 4.9, 12.4, 6.65] });
        dropOpening(t, { o: 'h', at: 4.9, c: 12.0 });
        t.openings.push({ o: 'h', at: 4.9, c: 13.0, w: 0.75, k: 'door', sw: 1, hg: -1 }, { o: 'v', at: 12.4, c: 5.25, w: 0.66, k: 'open' }, { o: 'v', at: 12.4, c: 6.1, w: 1.08, k: 'glass' });
        dropF(t, at('vanity', 12.82, 5.15), at('toilet', 12.5, 6.3), at('shower', 13.64, 5.76));
        t.furniture.push(
          { f: 'toilet', x: 13.75, y: 6.3, face: 'up' },
          { f: 'vanity', x: 12.85, y: 6.4, face: 'up', a: [0.6] },
          { f: 'rainShower', x: 11.9, y: 6.6, face: 'up' },
        );
      },
    },
  ],
};

export const schemeById = id => Object.values(SCHEMES).flat().find(s => s.id === id);

// 依需求單由 Claude Code 設計的方案（data/custom/<需求單編號>.json，經 /custom/ 提供）：整份樣板資料，不含程式
export async function loadCustom(rid) {
  if (!/^[0-9a-f]{8}$/.test(rid) || schemeById('r' + rid)) return schemeById('r' + rid);
  const r = await fetch(`/custom/${rid}.json`); if (!r.ok) return null;
  const d = await r.json(); if (!SCHEMES[d.kind]) return null;
  const s = {
    id: 'r' + rid, custom: true, req: rid, name: d.name || '你的方案', tag: d.tag || '依需求單設計', summary: d.summary || '',
    changes: d.changes, comfort: d.comfort, legal: d.legal, results: d.results || [], shot: d.shot,
    apply(t) { Object.assign(t, { label: d.label || t.label, rooms: d.rooms, openings: d.openings, furniture: d.furniture }); },
  };
  SCHEMES[d.kind].push(s);
  return s;
}
// 網址參數 scheme=c2,m1 → { corner: 'c2', mid: 'm1' }
export function parseSchemes(str) {
  const out = { corner: 'c0', mid: 'm0' };
  for (const id of (str || '').split(',')) for (const [k, list] of Object.entries(SCHEMES)) if (list.some(s => s.id === id)) out[k] = id;
  return out;
}
