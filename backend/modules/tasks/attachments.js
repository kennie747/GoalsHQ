const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Op } = require('sequelize');
const { getConfig } = require('../../config/config');
const config = getConfig();
const { Attachment } = require('../../models');
const { uid } = require('../../utils/uid');
const { logError } = require('../../services/logService');
const {
    validateFileType,
    getExtensionFromMimeType,
    deleteFileFromDisk,
    getFileUrl,
} = require('../../utils/attachment-utils');
const { getAuthenticatedUserId } = require('../../utils/request-utils');
const { resolveParent } = require('../attachments/parents');
const {
    createResourceLimiter,
    authenticatedApiLimiter,
} = require('../../middleware/rateLimiter');

const router = express.Router();

// Ensure authenticated
router.use((req, res, next) => {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    req.authUserId = userId;
    next();
});

// Per-parent-type storage subdir. Tasks keep 'tasks/' (existing URLs); anything
// else goes under 'attachments/'.
function subdirFor(parentType) {
    return parentType === 'task' ? 'tasks' : 'attachments';
}
function filePrefixFor(parentType) {
    return parentType === 'task' ? 'task' : 'att';
}

const storage = multer.diskStorage({
    destination(req, file, cb) {
        const dir = path.join(
            config.uploadPath,
            subdirFor(req.body.parentType || 'task')
        );
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename(req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        // Extension from the whitelist-validated MIME type, never the client
        // filename (GHSA-x24w-9w59-wqhq).
        const ext = getExtensionFromMimeType(file.mimetype);
        cb(
            null,
            `${filePrefixFor(req.body.parentType || 'task')}-${uniqueSuffix}${ext}`
        );
    },
});

const upload = multer({
    storage,
    limits: { fileSize: config.fileUploadLimitMB * 1024 * 1024 },
    fileFilter(req, file, cb) {
        return validateFileType(file.mimetype)
            ? cb(null, true)
            : cb(new Error('File type not allowed'));
    },
});

// Normalize task-only params/body into the generic (parentType, parentUid).
function normalizeParent(req) {
    if (req.body && req.body.parentType && req.body.parentUid) {
        return {
            parentType: req.body.parentType,
            parentUid: req.body.parentUid,
        };
    }
    if (req.body && req.body.taskUid) {
        return { parentType: 'task', parentUid: req.body.taskUid };
    }
    if (req.params && req.params.taskUid) {
        return { parentType: 'task', parentUid: req.params.taskUid };
    }
    if (req.params && req.params.parentType && req.params.parentUid) {
        return {
            parentType: req.params.parentType,
            parentUid: req.params.parentUid,
        };
    }
    return null;
}

// Matches both new (parent_type/parent_id) and legacy (task_id-only) rows.
function whereForParent(parent) {
    if (parent.type === 'task') {
        return {
            [Op.or]: [
                { parent_type: 'task', parent_id: parent.id },
                { task_id: parent.id },
            ],
        };
    }
    return { parent_type: parent.type, parent_id: parent.id };
}

async function handleUpload(req, res) {
    const cleanup = async () => {
        if (req.file) await deleteFileFromDisk(req.file.path);
    };
    try {
        const ref = normalizeParent(req);
        const isTask = !ref || ref.parentType === 'task';
        if (!ref) {
            await cleanup();
            return res.status(400).json({
                error: isTask
                    ? 'Task UID is required'
                    : 'parentType and parentUid are required',
            });
        }
        const parent = await resolveParent(
            ref.parentType,
            ref.parentUid,
            req.authUserId
        );
        if (!parent) {
            await cleanup();
            return res.status(404).json({
                error: isTask ? 'Task not found' : 'Parent not found',
            });
        }
        if (!(await parent.canWrite())) {
            await cleanup();
            return res.status(403).json({
                error: isTask
                    ? 'Not authorized to upload to this task'
                    : 'Not authorized',
            });
        }

        const count = await Attachment.count({ where: whereForParent(parent) });
        if (count >= 20) {
            await cleanup();
            return res.status(400).json({
                error:
                    parent.type === 'task'
                        ? 'Maximum 20 attachments allowed per task'
                        : 'Maximum 20 attachments allowed',
            });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const attachment = await Attachment.create({
            uid: uid(),
            parent_type: parent.type,
            parent_id: parent.id,
            task_id: parent.type === 'task' ? parent.id : null,
            user_id: req.authUserId,
            original_filename: req.file.originalname,
            stored_filename: req.file.filename,
            file_size: req.file.size,
            mime_type: req.file.mimetype,
            file_path: `${subdirFor(parent.type)}/${req.file.filename}`,
        });

        res.status(201).json({
            ...attachment.toJSON(),
            file_url: getFileUrl(req.file.filename, subdirFor(parent.type)),
        });
    } catch (error) {
        logError('Error uploading attachment:', error);
        await cleanup();
        res.status(500).json({
            error: 'Failed to upload attachment',
            details: error.message,
        });
    }
}

// Upload — generic + task alias.
router.post(
    '/upload/attachment',
    createResourceLimiter,
    upload.single('file'),
    handleUpload
);
router.post(
    '/upload/task-attachment',
    createResourceLimiter,
    upload.single('file'),
    handleUpload
);

// List — generic + task alias.
async function handleList(req, res) {
    try {
        const ref = normalizeParent(req);
        const parent = await resolveParent(
            ref.parentType,
            ref.parentUid,
            req.authUserId
        );
        if (!parent) {
            return res.status(404).json({
                error:
                    ref.parentType === 'task'
                        ? 'Task not found'
                        : 'Parent not found',
            });
        }
        if (!(await parent.canRead())) {
            return res.status(403).json({
                error:
                    ref.parentType === 'task'
                        ? 'Not authorized to view this task'
                        : 'Not authorized',
            });
        }
        const rows = await Attachment.findAll({
            where: whereForParent(parent),
            order: [['created_at', 'ASC']],
        });
        res.json(
            rows.map((a) => ({
                ...a.toJSON(),
                file_url: getFileUrl(
                    a.stored_filename,
                    subdirFor(a.parent_type)
                ),
            }))
        );
    } catch (error) {
        logError('Error fetching attachments:', error);
        res.status(500).json({ error: 'Failed to fetch attachments' });
    }
}
router.get('/tasks/:taskUid/attachments', handleList);
router.get(
    '/attachments/:parentType(task|goalshq_record)/:parentUid',
    handleList
);

// Delete.
async function handleDelete(req, res) {
    try {
        const { Task } = require('../../models');
        // Old route form scopes the attachment to a task uid.
        let taskId = null;
        if (req.params.taskUid) {
            const task = await Task.findOne({
                where: { uid: req.params.taskUid },
            });
            if (!task) return res.status(404).json({ error: 'Task not found' });
            taskId = task.id;
        }
        const attachment = await Attachment.findOne({
            where: { uid: req.params.attachmentUid },
        });
        if (
            !attachment ||
            (taskId != null &&
                attachment.task_id !== taskId &&
                attachment.parent_id !== taskId)
        ) {
            return res.status(404).json({ error: 'Attachment not found' });
        }
        if (!(await attachmentWriteCheck(attachment, req.authUserId))) {
            return res.status(403).json({
                error:
                    attachment.parent_type === 'task'
                        ? 'Not authorized to modify this task'
                        : 'Not authorized',
            });
        }
        await deleteFileFromDisk(
            path.join(config.uploadPath, attachment.file_path)
        );
        await attachment.destroy();
        res.json({ message: 'Attachment deleted successfully' });
    } catch (error) {
        logError('Error deleting attachment:', error);
        res.status(500).json({ error: 'Failed to delete attachment' });
    }
}
router.delete(
    '/tasks/:taskUid/attachments/:attachmentUid',
    createResourceLimiter,
    handleDelete
);
router.delete(
    '/attachments/:attachmentUid',
    createResourceLimiter,
    handleDelete
);

// Download.
router.get(
    '/attachments/:attachmentUid/download',
    authenticatedApiLimiter,
    async (req, res) => {
        try {
            const attachment = await Attachment.findOne({
                where: { uid: req.params.attachmentUid },
            });
            if (!attachment) {
                return res.status(404).json({ error: 'Attachment not found' });
            }
            if (!(await attachmentReadCheck(attachment, req.authUserId))) {
                return res.status(403).json({
                    error:
                        attachment.parent_type === 'task'
                            ? 'Not authorized to download this file'
                            : 'Not authorized',
                });
            }
            res.download(
                path.join(config.uploadPath, attachment.file_path),
                attachment.original_filename
            );
        } catch (error) {
            logError('Error downloading attachment:', error);
            res.status(500).json({ error: 'Failed to download attachment' });
        }
    }
);

/* ------- access helpers that work from an attachment row (no parent uid) ---- */

async function parentRefFromAttachment(attachment) {
    const { Task, GoalshqRecord } = require('../../models');
    if (attachment.parent_type === 'task') {
        const t = await Task.findByPk(
            attachment.parent_id || attachment.task_id
        );
        return t ? { type: 'task', uid: t.uid } : null;
    }
    if (attachment.parent_type === 'goalshq_record') {
        const r = await GoalshqRecord.findByPk(attachment.parent_id);
        return r ? { type: 'goalshq_record', uid: r.uid } : null;
    }
    return null;
}

async function attachmentReadCheck(attachment, userId) {
    if (attachment.user_id === userId) return true;
    const ref = await parentRefFromAttachment(attachment);
    if (!ref) return false;
    const parent = await resolveParent(ref.type, ref.uid, userId);
    return parent ? parent.canRead() : false;
}
async function attachmentWriteCheck(attachment, userId) {
    if (attachment.user_id === userId) return true;
    const ref = await parentRefFromAttachment(attachment);
    if (!ref) return false;
    const parent = await resolveParent(ref.type, ref.uid, userId);
    return parent ? parent.canWrite() : false;
}

module.exports = router;
