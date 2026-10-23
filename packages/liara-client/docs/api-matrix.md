# ماتریس تطبیق APIهای رسمی لیارا و ابزارهای سُکان (API Matrix)

این سند، نتیجه‌ی تحلیل منبع‌محور (Source Provenance) مقایسه‌ی مشخصات رسمی OpenAPI لیارا (`knowledge/sources/openapi/spec/`) با کدهای کلاینت CLI رسمی (`knowledge/sources/cli/src/`) بر اساس نیازمندی‌های وایت‌پیپر سُکان (§۶، §۱۳ و پیوست الف) است.

---

## ۱. جدول تطبیق اندپوینت‌ها، متدها و سطوح دسترسی

| ابزار سُکان | متد HTTP | اندپوینت (Path) | سرویس و Base URL | منبع (Provenance) | سطح ریسک | توضیحات و پارامترها |
|---|---|---|---|---|---|---|
| `account_get` | `GET` | `/v1/me` | `https://api.liara.ir` | OAS + CLI | L0 | اطلاعات کاربر، پلن‌های کاتالوگ (`plans.projects`، فرمول ماهانه: `price × 720`) |
| `billing_get_balance` | `GET` | `/v1/billing` | `https://api.liara.ir` | OAS | L0 | موجودی حساب (`balance`) و حداقل اعتبار (`minCreditAmount`) |
| `account_free_credit` | `GET` | `/v1/me/free-credit` | `https://api.liara.ir` | OAS | L0 | اعتبار رایگان هدیه |
| `app_list` | `GET` | `/v1/projects` | `https://api.liara.ir` | OAS | L0 | فهرست اپلیکیشن‌ها و وضعیت استقرار |
| `app_get` | `GET` | `/v1/projects/{name}` | `https://api.liara.ir` | OAS | L0 | جزئیات وضعیت، `scale`، `planID`، `envs`، `zeroDowntime` |
| `app_create` | `POST` | `/v1/projects` | `https://api.liara.ir` | OAS + CLI | **L2** (هزینه) | ساخت اپ جدید با `{name, planID, platform, bundlePlanID, network, readOnlyRootFilesystem}` |
| `app_restart` | `POST` | `/v1/projects/{name}/actions/restart` | `https://api.liara.ir` | OAS | **L2** | راه‌اندازی مجدد کانتینر |
| `app_scale` | `POST` | `/v1/projects/{name}/actions/scale` | `https://api.liara.ir` | OAS | روشن: L2 / خاموش (0): **L3** | تغییر تعداد نمونه (`scale: 0|1`) |
| `app_resize_plan` | `POST` | `/v1/projects/{name}/resize` | `https://api.liara.ir` | OAS | **L2** (هزینه+ری‌استارت) | تغییر پلن منابع سخت‌افزاری با `{planID}` |
| `app_update_envs` | `POST` | `/v1/projects/update-envs` | `https://api.liara.ir` | OAS | **L2** (ری‌استارت) | به‌روزرسانی متغیرهای محیطی با `{project, variables:[{key,value}]}` |
| `app_update_port` | `POST` | `/v1/projects/update-port` | `https://api.liara.ir` | CLI | **L2** | تغییر پورت گوش دادن اپلیکیشن (اختصاصی CLI) |
| `app_set_zero_downtime`| `POST` | `/v1/projects/{id}/zero-downtime/{status}` | `https://api.liara.ir` | OAS | L1 | فعال/غیرفعال‌سازی Zero Downtime |
| `app_delete` | `DELETE` | `/v1/projects/{name}` | `https://api.liara.ir` | OAS | **L3** (تخریبی) | حذف کامل اپ و داده‌ها (نیازمند تایپ نام اپ و پنجره ۱۰ ثانیه‌ای لغو) |
| `source_upload` | `POST` | `/v2/projects/{name}/sources` | `https://api.liara.ir` | OAS + CLI | L1 | آپلود سورس فشرده `.tar.gz` (حداکثر ۲۵۶ مگابایت) ← بازگشت `sourceID` |
| `release_create` | `POST` | `/v2/projects/{name}/releases` | `https://api.liara.ir` | OAS + CLI | **L2** | ایجاد ریلیز جدید با `{sourceID, port, type, envs, build, healthCheck, ...}` |
| `release_build_logs` | `GET` | `/v2/releases/{id}/build-logs?since=` | `https://api.liara.ir` | CLI | L0 | دریافت و استریم لاگ‌های فرآیند بیلد |
| `release_get` | `GET` | `/v1/releases/{id}` | `https://api.liara.ir` | CLI | L0 | وضعیت و جزئیات یک ریلیز |
| `release_cancel` | `POST` | `/v2/releases/{id}/cancel` | `https://api.liara.ir` | CLI | L1 | لغو فرآیند استقرار جاری |
| `release_list` | `GET` | `/v1/projects/{name}/releases` | `https://api.liara.ir` | OAS | L0 | تاریخچه نسخه‌ها با وضعیت (`READY`, `FAILED`, `UNHEALTHY`) |
| `release_rollback` | `POST` | `/v2/projects/{name}/releases` | `https://api.liara.ir` | ترکیبی | **L2** | استقرار مجدد با `imageName` آخرین نسخه سالم قبلی |
| `logs_get` | `GET` | `/v2/projects/{name}/logs` | `https://api.liara.ir` | OAS + CLI | L0 | دریافت لاگ‌های تجمیعی (`start`, `direction`, `last_lines`) |
| `events_get` | `GET` | `/v1/projects/{name}/events` | `https://api.liara.ir` | OAS | L0 | رویدادهای سیستمی و کانتینری در بازه زمانی |
| `applets_get` | `GET` | `/v1/projects/{name}/applets` | `https://api.liara.ir` | OAS | L0 | وضعیت کانتینرها، تعداد ری‌استارت و دلیل خطا (`reason`) |
| `metrics_summary` | `GET` | `/v1/projects/{name}/metrics/summary` | `https://api.liara.ir` | OAS | L0 | خلاصه مصرف پردازنده، حافظه و دیسک نسبت به سقف پلن |
| `metrics_series` | `GET` | `/v1/projects/{name}/metrics/{cpu\|memory\|network-receive\|network-transmit}` | `https://api.liara.ir` | OAS | L0 | سری زمانی مصرف منابع به تفکیک کانتینرها |
| `disks_list` | `GET` | `/v1/projects/{id}/disks` | `https://api.liara.ir` | OAS | L0 | فهرست دیسک‌های متصل و فضای مصرفی |
| `domain_list` | `GET` | `/v1/domains` | `https://api.liara.ir` | OAS | L0 | فهرست دامنه‌های متصل |
| `domain_add` | `POST` | `/v1/domains` | `https://api.liara.ir` | OAS | L1 | اتصال دامنه جدید با `{name, project, type: "PROJECT"}` |
| `domain_check` | `GET` | `/v1/domains/{id}/check` | `https://api.liara.ir` | OAS | L0 | وضعیت اتصال دامنه، گواهینامه SSL و رکورد CNAME |
| `domain_enable_ssl` | `POST` | `/v1/domains/provision-ssl-certs` | `https://api.liara.ir` | OAS | L1 | درخواست صدور گواهینامه SSL رایگان Let's Encrypt |
| `domain_set_redirect` | `POST` | `/v1/domains/{id}/set-redirect` | `https://api.liara.ir` | OAS | **L2** | تنظیم ریدایرکت دامنه |
| `domain_delete` | `DELETE` | `/v1/domains/{id}` | `https://api.liara.ir` | OAS | **L3** | حذف اتصال دامنه |
| `dns_zone_create` | `POST` | `/api/v1/zones` | `https://dns-service.liara.ir` | OAS | L1 | ایجاد Zone دامنه‌ی جدید در سرویس DNS لیارا |
| `dns_zone_check_ns` | `PUT` | `/api/v1/zones/{zone}/check` | `https://dns-service.liara.ir` | OAS | L0 | بررسی وضعیت انتشار NameServerها (از جمله برای ایرنیک) |
| `dns_record_upsert` | `POST/PUT` | `/api/v1/zones/{zone}/dns-records[/{id}]`| `https://dns-service.liara.ir` | OAS | **L2** | ایجاد یا ویرایش رکوردهای DNS |
| `db_list` / `db_get` | `GET` | `/v1/databases[/{id}]` | `https://api.liara.ir` | OAS | L0 | وضعیت سرویس‌های دیتابیس |
| `db_metrics` | `GET` | `/v1/databases/{id}/metrics/{summary\|cpu\|memory}` | `https://api.liara.ir` | OAS | L0 | بررسی بار پردازشی و مصرف رم پایگاه‌داده |
| `db_backup_create` | `POST` | `/v1/databases/{id}/backups` | `https://api.liara.ir` | OAS | L1 | پشتیبان‌گیری فوری از دیتابیس قبل از اعمال تغییرات |
| `db_resize` | `POST` | `/v1/databases/{id}/resize` | `https://api.liara.ir` | OAS | **L2** | ارتقای پلن پایگاه‌داده |

---

## ۲. نگاشت کدهای خطای HTTP به راهنمای انسانی (HumanError Mapping)

طبق استاندارد بخش ۱۲.۱ و ۶.۳ وایت‌پیپر، هیچ خطای خامی به کاربر نمایش داده نمی‌شود. هر خطا شامل ۳ مؤلفه است: **چه شد؟**، **چرا؟** و **حالا چه کنیم؟**

| کد وضعیت HTTP | علت فنی | پیام ساده به کاربر (چه شد؟) | چرا؟ | اقدام پیشنهادی (حالا چه کنیم؟) |
|---|---|---|---|---|
| `401 Unauthorized` | توکن نامعتبر یا منقضی | عدم امکان اتصال به لیارا | توکن دسترسی واردشده معتبر نیست یا منقضی شده است. | از منوی حساب کاربری > دسترسی API در کنسول لیارا توکن جدید دریافت و وارد کنید. |
| `402 Payment Required` | موجودی ناکافی کیف پول | اعتبار حساب شما کمتر از هزینه عملیات است | برای ساخت یا ارتقای پلن، موجودی ریالی باید حداقل برابر با هزینه دوره اول باشد. | از بخش افزایش اعتبار کنسول لیارا حسابتان را شارژ کنید؛ سپس ادامه دهید. |
| `403 Forbidden` | محدودیت پلن یا پلتفرم | عملیات غیرمجاز در پلن فعلی | ممکن است سقف برنامه‌های پلن رایگان پر شده باشد یا دسترسی به این نوع پروژه محدود باشد. | انتخاب پلن استاندارد یا حذف پروژه‌های بدون استفاده. |
| `404 Not Found` | منبع یافت نشد | برنامه یا شناسه موردنظر پیدا نشد | نام برنامه اشتباه وارد شده یا متعلق به تیم/حساب دیگری است. | بررسی صحت نام برنامه با دستور `app_list` و تطبیق با کنسول. |
| `409 Conflict` | تکرار نام منبع | نام انتخاب‌شده قبلاً رزرو شده است | نام انتخابی در شبکه سراسری لیارا توسط کاربر دیگری در حال استفاده است. | پیشنهاد ۳ نام تصادفی و آزاد یا تغییر پسوند نام برنامه. |
| `413 Payload Too Large`| سورس بیش از ۲۵۶ مگابایت | حجم سورس کد بسیار زیاد است | پوشه‌های اضافی مثل `node_modules`، `.git` یا فایل‌های مالتی‌مدیا در آرشیو قرار دارند. | ایجاد یا تکمیل فایل `.liaraignore` و حذف پوشه‌های بیلد محلی. |
| `428 Precondition` | سقف روزانه دیپلوی | سقف انتشار روزانه به پایان رسیده | پلن رایگان یا فیچر دارای محدودیت تعداد دیپلوی در هر شبانه‌روز است. | ارتقای Feature Bundle در کنسول لیارا یا انتظار تا شروع روز بعد. |

---

## ۳. محدودیت‌های شفاف API و مرزهای سیستم

1. **عملیات پرداخت بانکی:** به دلیل حساسیت‌های امنیتی، سُکان هیچ دسترسی به کارت بانکی یا شارژ خودکار ندارد. محاسبه دقیق اختلاف هزینه انجام شده و لینک مستقیم کنسول به کاربر داده می‌شود.
2. **تغییر NameServer ایرنیک:** ایرنیک فاقد API عمومی احراز هویت شده برای تغییر NS است؛ سُکان چک‌لیست مقادیر کپی‌کردنی را تولید و پس از تغییر دستی توسط کاربر، وضعیت انتشار را به صورت زمان‌بندی‌شده پایش می‌کند.
3. **متریک‌های سطح درخواست (Request-level Latency / Error Rate):** از آنجا که APIهای زیرساختی لیارا صرفاً مصرف سخت‌افزاری می‌دهند، سُکان از **پروب خارجی مستقل (HTTP Probe)** و **تحلیل لاگ‌های دسترسی** برای اندازه‌گیری زمان پاسخ p95 و نرخ خطای ۵۰۰ استفاده می‌کند.
