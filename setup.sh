#!/bin/bash
set -e

# ============================================================
#  pochta_bot — setup script
#  Автоматическая установка Telegram-бота на Ubuntu-сервер
# ============================================================

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║        pochta_bot — установка на сервер             ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# -----------------------------------------------------------
# 1. Обновление системы
# -----------------------------------------------------------
echo "[1/6] Обновление пакетов системы..."
apt update && apt upgrade -y

# -----------------------------------------------------------
# 2. Установка зависимостей
# -----------------------------------------------------------
echo "[2/6] Установка curl, git, build-essential..."
apt install -y curl git build-essential

# -----------------------------------------------------------
# 3. Node.js LTS (v20)
# -----------------------------------------------------------
echo "[3/6] Установка Node.js 20 LTS..."
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
else
  echo "  Node.js уже установлен: $(node -v)"
fi

# -----------------------------------------------------------
# 4. PM2
# -----------------------------------------------------------
echo "[4/6] Установка PM2..."
npm install -g pm2

# -----------------------------------------------------------
# 5. npm install
# -----------------------------------------------------------
echo "[5/6] Установка зависимостей проекта..."
npm install

# -----------------------------------------------------------
# 6. Сбор переменных окружения
# -----------------------------------------------------------
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║        Настройка переменных окружения               ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

read -rp "[1]  Введите токен Telegram-бота (от @BotFather): " TELEGRAM_BOT_TOKEN

read -rp "[2]  Введите OpenAI API ключ: " OPENAI_API_KEY

read -rp "[3]  Модель OpenAI [gpt-4o]: " OPENAI_MODEL
OPENAI_MODEL="${OPENAI_MODEL:-gpt-4o}"

read -rp "[4]  Введите Mistral API ключ (или Enter, если не используется): " MISTRAL_API_KEY

read -rp "[5]  SMTP хост (например: smtp.yandex.ru): " SMTP_HOST

read -rp "[6]  SMTP порт [587]: " SMTP_PORT
SMTP_PORT="${SMTP_PORT:-587}"

read -rp "[7]  SMTP пользователь (email): " SMTP_USER

read -rsp "[8]  SMTP пароль: " SMTP_PASS
echo ""

read -rp "[9]  From-адрес [${SMTP_USER}]: " SMTP_FROM
SMTP_FROM="${SMTP_FROM:-$SMTP_USER}"

read -rsp "[10] Пароль администратора бота: " ADMIN_PASSWORD
echo ""

read -rp "[11] URL Supabase проекта: " SUPABASE_URL

read -rsp "[12] Supabase Service Role ключ: " SUPABASE_SERVICE_ROLE_KEY
echo ""

read -rp "[13] Таймаут сессии в минутах [10]: " SESSION_TIMEOUT_MINUTES
SESSION_TIMEOUT_MINUTES="${SESSION_TIMEOUT_MINUTES:-10}"

read -rp "[14] Макс. размер PDF в МБ [10]: " MAX_PDF_SIZE_MB
MAX_PDF_SIZE_MB="${MAX_PDF_SIZE_MB:-10}"

read -rp "[15] Макс. генераций в день [100]: " MAX_GENERATIONS_PER_DAY
MAX_GENERATIONS_PER_DAY="${MAX_GENERATIONS_PER_DAY:-100}"

# -----------------------------------------------------------
# 7. Запись .env
# -----------------------------------------------------------
echo ""
echo "[6/6] Создание файла .env..."
cat > .env <<EOF
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
OPENAI_API_KEY=${OPENAI_API_KEY}
OPENAI_MODEL=${OPENAI_MODEL}
MISTRAL_API_KEY=${MISTRAL_API_KEY}

SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_USER=${SMTP_USER}
SMTP_PASS=${SMTP_PASS}
SMTP_FROM=${SMTP_FROM}

ADMIN_PASSWORD=${ADMIN_PASSWORD}

SUPABASE_URL=${SUPABASE_URL}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}

SESSION_TIMEOUT_MINUTES=${SESSION_TIMEOUT_MINUTES}
MAX_PDF_SIZE_MB=${MAX_PDF_SIZE_MB}
MAX_GENERATIONS_PER_DAY=${MAX_GENERATIONS_PER_DAY}
EOF

echo "  .env создан."

# -----------------------------------------------------------
# 8. Запуск через PM2
# -----------------------------------------------------------
echo ""
echo "Запуск бота через PM2..."
pm2 start src/bot/index.js --name pochta_bot

pm2 save

echo ""
echo "Настройка автозапуска PM2 при перезагрузке сервера:"
pm2 startup || true
echo "(Выполни команду выше вручную, если она была выведена)"

# -----------------------------------------------------------
# Финал
# -----------------------------------------------------------
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   Бот успешно запущен!                              ║"
echo "║   Проверь статус: pm2 logs pochta_bot               ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
