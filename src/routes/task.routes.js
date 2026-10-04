'use strict';

const express = require('express');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { schemas } = require('../validation/schemas');

function taskRoutes({ taskService, authService }) {
  const router = express.Router();
  router.use(authenticate(authService));

  router.get('/', validate(schemas.listTasks, 'query'), async (req, res) => {
    res.json(await taskService.list(req.user.id, req.validated.query));
  });

  router.get('/stats', async (req, res) => {
    res.json(await taskService.stats(req.user.id));
  });

  router.post('/', validate(schemas.createTask), async (req, res) => {
    const task = await taskService.create(req.user.id, req.validated.body);
    res.status(201).location(`/api/tasks/${task.id}`).json(task);
  });

  router.get('/:id', validate(schemas.taskId, 'params'), async (req, res) => {
    res.json(await taskService.get(req.user.id, req.validated.params.id));
  });

  router.patch(
    '/:id',
    validate(schemas.taskId, 'params'),
    validate(schemas.updateTask),
    async (req, res) => {
      res.json(await taskService.update(req.user.id, req.validated.params.id, req.validated.body));
    },
  );

  router.delete('/:id', validate(schemas.taskId, 'params'), async (req, res) => {
    await taskService.remove(req.user.id, req.validated.params.id);
    res.status(204).end();
  });

  return router;
}

module.exports = { taskRoutes };
