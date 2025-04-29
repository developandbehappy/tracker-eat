const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3006;
const DATA_DIR = path.join(__dirname, 'data');
const TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json');

// Middleware
app.use(bodyParser.json());
app.use(express.static(__dirname)); // Для обслуживания HTML, CSS, JS файлов

// Создаем структуру директорий, если она не существует
function ensureDirectoriesExist(callback) {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdir(DATA_DIR, { recursive: true }, (err) => {
            if (err && err.code !== 'EEXIST') {
                console.error('Ошибка при создании директорий:', err);
                return callback(err);
            }
            console.log('Директория для данных создана');
            callback(null);
        });
    } else {
        callback(null);
    }
}

// Получение начала недели по дате
function getStartOfWeek(date) {
    const result = new Date(date);
    const day = result.getDay();
    const diff = result.getDate() - day + (day === 0 ? -6 : 1); // Корректировка для воскресенья
    result.setDate(diff);
    return result;
}

// Форматирование даты в YYYY-MM-DD
function formatDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Получение имени файла для недели
function getWeekFileName(date) {
    const startOfWeek = getStartOfWeek(date);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    const startFormatted = formatDate(startOfWeek);
    const endFormatted = formatDate(endOfWeek);

    return `week_${startFormatted}_to_${endFormatted}.json`;
}

// Загрузка данных за неделю
function loadWeekData(date, callback) {
    const fileName = getWeekFileName(date);
    const filePath = path.join(DATA_DIR, fileName);

    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                return callback(null, {}); // Если файл не существует, возвращаем пустой объект
            }
            return callback(err);
        }

        try {
            const jsonData = JSON.parse(data);
            callback(null, jsonData);
        } catch (parseErr) {
            callback(parseErr);
        }
    });
}

// Сохранение данных за неделю
function saveWeekData(date, data, callback) {
    const fileName = getWeekFileName(date);
    const filePath = path.join(DATA_DIR, fileName);

    const jsonData = JSON.stringify(data, null, 2);

    fs.writeFile(filePath, jsonData, 'utf8', callback);
}

// Загрузка шаблонов
function loadTemplates(callback) {
    fs.readFile(TEMPLATES_FILE, 'utf8', (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                return callback(null, { templates: {}, usage: {} }); // Если файл не существует, возвращаем пустую структуру
            }
            return callback(err);
        }

        try {
            const jsonData = JSON.parse(data);
            callback(null, jsonData);
        } catch (parseErr) {
            callback(parseErr);
        }
    });
}

// Сохранение шаблонов
function saveTemplates(templates, callback) {
    const jsonData = JSON.stringify(templates, null, 2);
    fs.writeFile(TEMPLATES_FILE, jsonData, 'utf8', callback);
}

// API эндпоинты

app.get('/api', (req, res) => {
    const dateStr = req.query.date || new Date().toISOString();

    res.json({ status: "ok" });
});

// Получение данных за неделю
app.get('/api/week', (req, res) => {
    const dateStr = req.query.date || new Date().toISOString();

    loadWeekData(dateStr, (err, weekData) => {
        if (err) {
            console.error('Ошибка при получении данных за неделю:', err);
            return res.status(500).json({ error: 'Не удалось получить данные за неделю' });
        }

        res.json(weekData);
    });
});

// Получение данных за конкретную дату
app.get('/api/meals/:date', (req, res) => {
    const { date } = req.params;
    const weekStart = getStartOfWeek(date);

    loadWeekData(weekStart, (err, weekData) => {
        if (err) {
            console.error('Ошибка при получении данных за дату:', err);
            return res.status(500).json({ error: 'Не удалось получить данные за дату' });
        }

        res.json(weekData[date] || []);
    });
});

// Добавление приема пищи
app.post('/api/meals', (req, res) => {
    const { date, time, description } = req.body;

    if (!date || !time || !description) {
        return res.status(400).json({ error: 'Необходимо указать дату, время и описание' });
    }

    const weekStart = getStartOfWeek(date);

    loadWeekData(weekStart, (err, weekData) => {
        if (err) {
            console.error('Ошибка при загрузке данных недели:', err);
            return res.status(500).json({ error: 'Не удалось добавить прием пищи' });
        }

        if (!weekData[date]) {
            weekData[date] = [];
        }

        const timestamp = new Date(`${date}T${time}`).getTime();

        weekData[date].push({
            time,
            description,
            timestamp
        });

        // Сортировка по времени
        weekData[date].sort((a, b) => a.timestamp - b.timestamp);

        saveWeekData(weekStart, weekData, (saveErr) => {
            if (saveErr) {
                console.error('Ошибка при сохранении данных недели:', saveErr);
                return res.status(500).json({ error: 'Не удалось добавить прием пищи' });
            }

            res.status(201).json({ success: true, meal: { date, time, description } });
        });
    });
});

// Обновление приема пищи
app.put('/api/meals/:date/:index', (req, res) => {
    const { date, index } = req.params;
    const { newDate, time, description } = req.body;

    if (!newDate || !time || !description) {
        return res.status(400).json({ error: 'Необходимо указать дату, время и описание' });
    }

    const oldWeekStart = getStartOfWeek(date);

    loadWeekData(oldWeekStart, (err, oldWeekData) => {
        if (err) {
            console.error('Ошибка при загрузке данных старой недели:', err);
            return res.status(500).json({ error: 'Не удалось обновить прием пищи' });
        }

        if (!oldWeekData[date] || !oldWeekData[date][index]) {
            return res.status(404).json({ error: 'Прием пищи не найден' });
        }

        // Удаление старой записи
        const mealToUpdate = oldWeekData[date].splice(index, 1)[0];

        if (oldWeekData[date].length === 0) {
            delete oldWeekData[date];
        }

        // Сохранение старой недели
        saveWeekData(oldWeekStart, oldWeekData, (saveOldErr) => {
            if (saveOldErr) {
                console.error('Ошибка при сохранении данных старой недели:', saveOldErr);
                return res.status(500).json({ error: 'Не удалось обновить прием пищи' });
            }

            const newWeekStart = getStartOfWeek(newDate);

            // Если дата изменилась, может потребоваться обновить другую неделю
            if (formatDate(oldWeekStart) !== formatDate(newWeekStart)) {
                loadWeekData(newWeekStart, handleNewWeekData);
            } else {
                handleNewWeekData(null, oldWeekData);
            }

            function handleNewWeekData(loadNewErr, newWeekData) {
                if (loadNewErr) {
                    console.error('Ошибка при загрузке данных новой недели:', loadNewErr);
                    return res.status(500).json({ error: 'Не удалось обновить прием пищи' });
                }

                // Добавление обновленной записи
                if (!newWeekData[newDate]) {
                    newWeekData[newDate] = [];
                }

                const timestamp = new Date(`${newDate}T${time}`).getTime();

                newWeekData[newDate].push({
                    time,
                    description,
                    timestamp
                });

                // Сортировка по времени
                newWeekData[newDate].sort((a, b) => a.timestamp - b.timestamp);

                // Сохранение новой недели
                saveWeekData(newWeekStart, newWeekData, (saveNewErr) => {
                    if (saveNewErr) {
                        console.error('Ошибка при сохранении данных новой недели:', saveNewErr);
                        return res.status(500).json({ error: 'Не удалось обновить прием пищи' });
                    }

                    res.json({
                        success: true,
                        meal: { date: newDate, time, description }
                    });
                });
            }
        });
    });
});

// Удаление приема пищи
app.delete('/api/meals/:date/:index', (req, res) => {
    const { date, index } = req.params;

    const weekStart = getStartOfWeek(date);

    loadWeekData(weekStart, (err, weekData) => {
        if (err) {
            console.error('Ошибка при загрузке данных недели:', err);
            return res.status(500).json({ error: 'Не удалось удалить прием пищи' });
        }

        if (!weekData[date] || !weekData[date][index]) {
            return res.status(404).json({ error: 'Прием пищи не найден' });
        }

        // Удаление записи
        weekData[date].splice(index, 1);

        if (weekData[date].length === 0) {
            delete weekData[date];
        }

        saveWeekData(weekStart, weekData, (saveErr) => {
            if (saveErr) {
                console.error('Ошибка при сохранении данных недели:', saveErr);
                return res.status(500).json({ error: 'Не удалось удалить прием пищи' });
            }

            res.json({ success: true });
        });
    });
});

// Получение шаблонов
app.get('/api/templates', (req, res) => {
    loadTemplates((err, templatesData) => {
        if (err) {
            console.error('Ошибка при получении шаблонов:', err);
            return res.status(500).json({ error: 'Не удалось получить шаблоны' });
        }

        res.json(templatesData);
    });
});

// Добавление шаблона
app.post('/api/templates', (req, res) => {
    const { name, description } = req.body;

    if (!name || !description) {
        return res.status(400).json({ error: 'Необходимо указать название и описание шаблона' });
    }

    loadTemplates((err, templatesData) => {
        if (err) {
            console.error('Ошибка при загрузке шаблонов:', err);
            return res.status(500).json({ error: 'Не удалось добавить шаблон' });
        }

        // Добавление шаблона
        templatesData.templates[name] = description;

        // Обновление использования
        if (!templatesData.usage[name]) {
            templatesData.usage[name] = 0;
        }
        templatesData.usage[name]++;

        saveTemplates(templatesData, (saveErr) => {
            if (saveErr) {
                console.error('Ошибка при сохранении шаблонов:', saveErr);
                return res.status(500).json({ error: 'Не удалось добавить шаблон' });
            }

            res.status(201).json({
                success: true,
                template: { name, description }
            });
        });
    });
});

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index22.html'));
});

// Инициализация и запуск сервера
ensureDirectoriesExist((err) => {
    if (err) {
        console.error('Ошибка при инициализации сервера:', err);
        return;
    }

    app.listen(PORT, () => {
        console.log(`Сервер запущен на порту ${PORT}`);
        console.log(`Откройте http://localhost:${PORT} в браузере`);
    });
});