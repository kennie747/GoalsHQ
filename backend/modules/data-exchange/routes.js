'use strict';

const express = require('express');
const multer = require('multer');
const router = express.Router();
const controller = require('./controller');

const checkEnabled = (req, res, next) => {
    if (process.env.FF_ENABLE_DATA_EXCHANGE !== 'true') {
        return res.status(403).json({
            error: 'The data exchange feature is disabled',
        });
    }
    next();
};

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const name = file.originalname.toLowerCase();
        const ok =
            name.endsWith('.xlsx') ||
            name.endsWith('.csv') ||
            file.mimetype ===
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            file.mimetype === 'text/csv';
        cb(ok ? null : new Error('Only .xlsx and .csv files are allowed'), ok);
    },
});

router.use('/data-exchange', checkEnabled);

router.get('/data-exchange/resources', controller.describe);
router.get('/data-exchange/template', controller.template);
router.get('/data-exchange/export', controller.export);
router.post(
    '/data-exchange/preview',
    upload.single('file'),
    controller.preview
);
router.post('/data-exchange/commit', upload.single('file'), controller.commit);
router.get('/data-exchange/jobs', controller.jobs);

module.exports = router;
