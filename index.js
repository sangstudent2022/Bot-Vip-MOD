// Xóa sạch terminal (tương thích đa nền tảng)
process.stdout.write('\x1Bc');

const fs = require("fs");
const path = require("path");
const CFonts = require('cfonts');
const chalk = require('chalk');
const axios = require("axios");
const semver = require("semver");
const moment = require("moment-timezone");

const CACHE_SUFFIX = ".sync-cache.json";
const IGNORED_FILE = ".sync-ignore-list.json"; // file chứa danh sách file không hỏi nữa

// ===== Đọc config và hỏi bật/tắt sync modules/commands/events nếu chưa có =====
const configPath = path.join(__dirname, "config.json");
let config = {};
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch (e) {
  config.syncmodulescomands = true;
  config.syncmodulesevents = true;
}
if (typeof config.syncmodulescomands === "undefined") {
  const ask = require('readline-sync').question;
  config.syncmodulescomands = ask("Bạn có muốn tự động đồng bộ lệnh modules/commands từ GitHub? (y/n): ").trim().toLowerCase() === "y";
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}
if (typeof config.syncmodulesevents === "undefined") {
  const ask = require('readline-sync').question;
  config.syncmodulesevents = ask("Bạn có muốn tự động đồng bộ lệnh modules/events từ GitHub? (y/n): ").trim().toLowerCase() === "y";
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

process.on('SIGINT', () => {
  console.log(chalk.redBright('\n[EXIT] Đang dừng chương trình...'));
  process.exit();
});

// Đọc cache các file từng có ở local
function readCache(cacheFile) {
  if (!fs.existsSync(cacheFile)) return [];
  try {
    return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  } catch (e) {
    return [];
  }
}

// Ghi lại cache các file local đã có lần sync này
function writeCache(cacheFile, files) {
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(files), "utf8");
  } catch (e) {}
}

// Đọc danh sách file đã chọn "nn" (không hỏi lại nữa, không tải nữa)
function readIgnoreList() {
  if (!fs.existsSync(IGNORED_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(IGNORED_FILE, "utf8"));
  } catch (e) {
    return [];
  }
}

// Ghi lại danh sách file đã chọn "nn"
function writeIgnoreList(files) {
  try {
    fs.writeFileSync(IGNORED_FILE, JSON.stringify(files), "utf8");
  } catch (e) {}
}

async function downloadAndSave(remoteFile, RAW_PREFIX, localDir) {
  try {
    const { data: remoteContent } = await axios.get(RAW_PREFIX + remoteFile.name, { responseType: 'arraybuffer' });
    fs.writeFileSync(path.join(localDir, remoteFile.name), Buffer.from(remoteContent));
    console.log(chalk.greenBright(`[SYNC] Đã thêm mới: ${remoteFile.name}`));
  } catch (e) {
    console.log(chalk.redBright(`[SYNC] Lỗi tải file ${remoteFile.name}: ${e.message}`));
  }
}

async function syncOnlyAddNew(localDir, githubDir) {
  const REMOTE_LIST_URL = `https://api.github.com/repos/Kenne400k/k/contents/${githubDir}`;
  const RAW_PREFIX = `https://raw.githubusercontent.com/Kenne400k/k/main/${githubDir}/`;
  const cacheFile = path.join(localDir, CACHE_SUFFIX);

  let ignoreList = readIgnoreList();

  try {
    console.log(chalk.cyanBright(`[SYNC] Đang kiểm tra và đồng bộ file mới từ GitHub: ${githubDir}`));
    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });

    const { data: remoteFiles } = await axios.get(REMOTE_LIST_URL, {
      headers: { 'User-Agent': 'mirai-bot-syncmodules' }
    });
    const remoteJsFiles = remoteFiles.filter(f => f.type === "file" && /\.(js|json|ts|cjs|mjs)$/i.test(f.name));
    const localFiles = fs.readdirSync(localDir).filter(f => /\.(js|json|ts|cjs|mjs)$/i.test(f));
    const cachedFiles = readCache(cacheFile);
    const missingFiles = remoteJsFiles.filter(f => !localFiles.includes(f.name));
    const newFiles = missingFiles.filter(f => !cachedFiles.includes(f.name));
    let deletedFiles = missingFiles.filter(f => cachedFiles.includes(f.name));
    deletedFiles = deletedFiles.filter(f => !ignoreList.includes(f.name));

    if (missingFiles.length > 10) {
      console.log(chalk.yellowBright(`[SYNC] Có ${missingFiles.length} lệnh mới (bao gồm ${deletedFiles.length} lệnh đã từng có và ${newFiles.length} lệnh hoàn toàn mới). Bạn có muốn tải về không? (y/n)`));
      process.stdin.setEncoding('utf8');
      await new Promise(resolve => {
        process.stdin.once('data', async (answer) => {
          if (answer.trim().toLowerCase() === 'y') {
            for (const remoteFile of missingFiles) {
              await downloadAndSave(remoteFile, RAW_PREFIX, localDir);
            }
            console.log(chalk.greenBright(`[SYNC] Đã đồng bộ xong ${missingFiles.length} file mới từ ${githubDir}.`));
          } else {
            console.log(chalk.yellowBright(`[SYNC] Bỏ qua việc tải lệnh mới.`));
          }
          resolve();
        });
      });
    } else {
      for (const remoteFile of newFiles) {
        await downloadAndSave(remoteFile, RAW_PREFIX, localDir);
      }
      for (const remoteFile of deletedFiles) {
        console.log(
          chalk.yellowBright(`[SYNC] File "${remoteFile.name}" đã từng có ở local nhưng bạn đã xóa. Bạn có muốn tải lại không? (y/n, nhập "nn" để không bao giờ hỏi lại lệnh này)`));
        console.log(
          chalk.yellowBright('[SYNC] Nếu bạn không muốn bị hỏi tải lại lệnh đã xóa, hãy nhập ') +
          chalk.magenta('nn') +
          chalk.yellowBright(' để không tải xuống và không hỏi lại nữa!')
        );
        process.stdin.setEncoding('utf8');
        await new Promise(resolve => {
          process.stdin.once('data', async (answer) => {
            const ans = answer.trim().toLowerCase();
            if (ans === 'y') {
              await downloadAndSave(remoteFile, RAW_PREFIX, localDir);
            } else if (ans === 'nn') {
              ignoreList.push(remoteFile.name);
              writeIgnoreList(ignoreList);
              console.log(chalk.gray(`[SYNC] File "${remoteFile.name}" đã được thêm vào danh sách không hỏi lại.`));
            } else {
              console.log(chalk.yellowBright(`[SYNC] Bỏ qua: ${remoteFile.name}`));
            }
            resolve();
          });
        });
      }
      if (missingFiles.length === 0) {
        console.log(chalk.yellowBright(`[SYNC] Không có file mới nào trong ${githubDir}.`));
      } else {
        console.log(chalk.greenBright(`[SYNC] Đã đồng bộ xong ${newFiles.length} file mới từ ${githubDir}.`));
      }
    }
    writeCache(cacheFile, Array.from(new Set([...localFiles, ...missingFiles.map(f => f.name)])));
  } catch (err) {
    console.log(chalk.redBright(`[SYNC] Lỗi đồng bộ ${githubDir}: ${err.message}`));
  }
}

async function syncModulesAndEvents() {
  if (config.syncmodulescomands !== false)
    await syncOnlyAddNew(path.join(__dirname, "modules", "commands"), "modules/commands");
  else
    console.log(chalk.gray('[SYNC] Tắt tự động đồng bộ modules/commands theo config.'));
  if (config.syncmodulesevents !== false)
    await syncOnlyAddNew(path.join(__dirname, "modules", "events"), "modules/events");
  else
    console.log(chalk.gray('[SYNC] Tắt tự động đồng bộ modules/events theo config.'));
}

// ============= KHỞI ĐỘNG GIAO DIỆN LOGO, QUẢNG CÁO, UPDATE... =============

(async () => {
  const boxen = (await import('boxen')).default;
  const chalkAnimation = await import('chalk-animation');

  // Animation khởi động
  const anim = chalkAnimation.default.rainbow('>>> MIRAI đang khởi động... <<<');
  await new Promise(r => setTimeout(r, 3000));
  anim.stop();

  const rainbowColors = ['red', 'yellow', 'green', 'cyan', 'blue', 'magenta', 'white', 'gray'];
  function getRandomColors(count = 5) {
     const shuffled = [...rainbowColors].sort(() => 0.5 - Math.random());
      return shuffled.slice(0, count);
  }

  // Logo
  CFonts.say('MIRAI BOT', {
    font: 'block',
    align: 'left',
    colors: getRandomColors(6),
    background: 'transparent',
    letterSpacing: 2,
    lineHeight: 1,
    space: true,
    maxLength: '0'
  });

  CFonts.say('DVT', {
    font: 'block',
    align: 'left',
    colors: getRandomColors(6),
    background: 'transparent',
    letterSpacing: 2,
    lineHeight: 1,
    space: true,
    maxLength: '0'
  });

  // Quảng cáo
  const fb = chalk.hex('#00acee').underline.bold('https://fb.com/dvt2k9');
  const banner =
    chalk.hex('#FFD700').bold('⚡ FILE BOT VIP! ⚡\n') +
    chalk.white('Facebook: ') + fb +
    ' ' + chalk.redBright('🔥');
  console.log(
    boxen(banner, {
      padding: 1,
      margin: { top: 1, bottom: 1, left: 0, right: 0 },
      borderStyle: 'round',
      borderColor: 'yellow',
      backgroundColor: '#111',
      title: chalk.bgYellow.black('  QUẢNG CÁO  '),
      titleAlignment: 'center'
    })
  );

  // Kiểm tra phiên bản
  const LOCAL_VERSION = "1.0.0";
  const GITHUB_RAW_URL = "https://raw.githubusercontent.com/Kenne400k/File-Free-PBot/refs/heads/main/index.js";
  console.log(chalk.cyanBright(`[AUTO-UPDATE] Kiểm tra phiên bản trên GitHub...`));
  try {
    const { data: remoteSource } = await axios.get(GITHUB_RAW_URL, { timeout: 7000 });
    const m = remoteSource.match(/LOCAL_VERSION\s*=\s*["'`](\d+\.\d+\.\d+)["'`]/i);
    const remoteVersion = m && m[1] ? m[1] : null;
    console.log(chalk.gray(`[DEBUG] Remote version extract:`), chalk.green(remoteVersion));

    if (!remoteVersion) {
      console.log(chalk.yellowBright('[UPDATE] Không xác định được version remote, tiếp tục chạy bản local.'));
    } else if (semver.eq(LOCAL_VERSION, remoteVersion)) {
      console.log(chalk.greenBright(`[CHECK] Phiên bản đang dùng là mới nhất: ${LOCAL_VERSION}`));
    } else if (semver.lt(LOCAL_VERSION, remoteVersion)) {
      console.log(chalk.cyanBright(`[UPGRADE] Có bản mới: ${remoteVersion}. Đang cập nhật...`));
      fs.writeFileSync(__filename, remoteSource, 'utf8');
      console.log(chalk.bgGreen.black(`[THÀNH CÔNG] Đã cập nhật lên bản mới: ${remoteVersion}`));
      const { spawn } = require("child_process");
      spawn(process.argv[0], [__filename, ...process.argv.slice(2)], { stdio: "inherit" });
      process.exit(0);
    } else {
      console.log(chalk.yellowBright(`[INFO] Bản local mới hơn remote. Tiếp tục chạy bản local.`));
    }
  } catch (e) {
    console.log(chalk.redBright(`[ERROR] Không thể kiểm tra/cập nhật phiên bản mới: ${e.message}`));
  }

  // ĐỒNG BỘ MODULES
  await syncModulesAndEvents();

  // Thông tin trạng thái
  const now = moment().format("YYYY-MM-DD HH:mm:ss");
  console.log(
    chalk.bgRed.white.bold(`  ${now}  `) +
    chalk.bgBlue.white.bold(`  Theme: MIRAI  `) +
    chalk.bgGreen.white.bold(`  Version: ${LOCAL_VERSION}  `) +
    chalk.bgYellow.black.bold(`  PID: ${process.pid}  `)
  );
  console.log(chalk.hex('#FFD700')('='.repeat(50)));
  console.log(chalk.hex('#ff00cc').italic('MiraiBot | DVT | Chúc bạn một ngày chạy bot vui vẻ!'));
  console.log(chalk.hex('#FFD700')('='.repeat(50)));

  // Fancy Logger
  const fancyLog = (type, msg, tag = "") => {
    let icons = { success: '✔', warn: '⚠', error: '✖', info: 'ℹ' };
    let colors = {
      success: chalk.greenBright, warn: chalk.yellowBright,
      error: chalk.redBright, info: chalk.cyanBright
    };
    let icon = colors[type] ? colors[type](icons[type]) : icons.info;
    let tagStr = tag ? chalk.bgHex("#333").white.bold(` ${tag} `) : "";
    let t = chalk.gray(`[${moment().format("HH:mm:ss")}]`);
    if (type === "error")
      console.log(t, icon, tagStr, chalk.red.underline.bold(msg));
    else
      console.log(t, icon, tagStr, colors[type] ? colors[type](msg) : msg);
  };
  fs.readFile('package.json', 'utf8', (err, data) => {
    if (!err) {
      try {
        const packageJson = JSON.parse(data);
        const dependencies = packageJson.dependencies || {};
        const totalDependencies = Object.keys(dependencies).length;
        fancyLog("success", `Tổng package: ${totalDependencies}`, "PACKAGE");
      } catch (_) {}
    }
    try {
      var files = fs.readdirSync('./modules/commands');
      files.forEach(file => { if (file.endsWith('.js')) require(`./modules/commands/${file}`); });
      fancyLog("success", 'Tiến hành check lỗi', 'AUTO-CHECK');
      fancyLog("success", 'Không phát hiện lỗi ở modules', 'AUTO-CHECK');
    } catch (error) {
      fancyLog("error", 'Lỗi ở lệnh:', 'AUTO-CHECK');
      console.log(error);
    }
  });

  // Tiếp tục khởi động bot như cũ
  const { spawn } = require("child_process");
  function startBot(message) {
    if (message) fancyLog("info", message, "BẮT ĐẦU");
    const child = spawn("node", ["--trace-warnings", "--async-stack-traces", "main.js"], {
      cwd: __dirname,
      stdio: "inherit",
      shell: true
    });
    child.on("close", (codeExit) => {
      if (codeExit != 0 || (global.countRestart && global.countRestart < 5)) {
        startBot("Mirai Loading - Đang khởi động lại...");
        global.countRestart = (global.countRestart || 0) + 1;
        return;
      }
    });
    child.on("error", function (error) {
      fancyLog("error", "Lỗi: " + JSON.stringify(error), "BẮT ĐẦU");
    });
  }

  // LOGIN FACEBOOK TOKEN và các hàm login như cũ
  const deviceID = require('uuid');
  const adid = require('uuid');
  const totp = require('totp-generator');
  const configLogin = require("./config.json");
  const logacc = require('./acc.json');

  async function login(){
    if(configLogin.ACCESSTOKEN !== "") return;
    if (!logacc || !logacc.EMAIL) return fancyLog("error", 'Thiếu email tài khoản', "LOGIN");
    var uid = logacc.EMAIL;
    var password = logacc.PASSWORD;
    var fa = logacc.OTPKEY;

    var form = {
        adid: adid.v4(),
        email: uid,
        password: password,
        format: 'json',
        device_id: deviceID.v4(),
        cpl: 'true',
        family_device_id: deviceID.v4(),
        locale: 'en_US',
        client_country_code: 'US',
        credentials_type: 'device_based_login_password',
        generate_session_cookies: '1',
        generate_analytics_claim: '1',
        generate_machine_id: '1',
        currently_logged_in_userid: '0',
        try_num: "1",
        enroll_misauth: "false",
        meta_inf_fbmeta: "NO_FILE",
        source: 'login',
        machine_id: randomString(24),
        meta_inf_fbmeta: '',
        fb_api_req_friendly_name: 'authenticate',
        fb_api_caller_class: 'com.facebook.account.login.protocol.Fb4aAuthHandler',
        api_key: '882a8490361da98702bf97a021ddc14d',
        access_token: '275254692598279|585aec5b4c27376758abb7ffcb9db2af'
    };

    form.sig = encodesig(sort(form));
    var options = {
        url: 'https://b-graph.facebook.com/auth/login',
        method: 'post',
        data: form,
        transformRequest: [
            (data, headers) => {
                return require('querystring').stringify(data)
            },
        ],
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            "x-fb-friendly-name": form["fb_api_req_friendly_name"],
            'x-fb-http-engine': 'Liger',
            'user-agent': 'Mozilla/5.0 (Linux; Android 12; TECNO CH9 Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/106.0.5249.79 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/389.0.0.38.105;]'
        }
    };

    try {
        let data = await axios(options);
        if(data.data.error) {
            if(data.data.error.error_subcode == 1348162) {
                let code_2fa = totp(fa.replace(/\s+/g, '').toLowerCase());
                form.twofactor_code = code_2fa;
                form.credentials_type = 'two_factor';
                form.userid = data.data.error.error_data.uid;
                form.first_factor = data.data.error.error_data.login_first_factor;
                form.machine_id = data.data.error.error_data.machine_id;
                form.sig = encodesig(sort(form));
                let dat = await axios(options);
                if(dat.data.error) return console.log(dat.data);
                else {
                    console.log(dat.data);
                    let token = dat.data.access_token;
                    let cookies = dat.data.session_cookies.map(i => i.name + "=" + i.value).join(";");
                    fs.writeFileSync('./token.json', JSON.stringify({ACCESSTOKEN: token, COOKIE: cookies}, null, 4));
                    fancyLog("success", "Đã đăng nhập thành công, vui lòng chạy lại bot", "LOGIN");
                }
            }
        } else {
            console.log(data.data);
            let token = data.data.access_token;
            let cookies = data.data.session_cookies.map(i => i.name + "=" + i.value).join(";");
            fs.writeFileSync('./token.json', JSON.stringify({ACCESSTOKEN: token, COOKIE: cookies}, null, 4));
            fancyLog("success", "Đã đăng nhập thành công, vui lòng chạy lại bot", "LOGIN");
        }
    } catch (e) {
        console.log(e.response?.data || e.message);
    }
  }

  function encodesig(data) {
    let sig = "";
    Object.keys(data).forEach(function (key) {
        sig += key + "=" + data[key];
    });
    sig += "62f8ce9f74b12f84c123cc23437a4a32";
    return require('crypto').createHash('md5').update(sig).digest("hex");
  }

  function sort(data) {
    return Object.keys(data).sort().reduce((acc, key) => {
      acc[key] = data[key];
      return acc;
    }, {});
  }

  function randomString(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
  }

  // login();

  startBot();
})();
