import { AppController } from './app.controller.js';

describe('AppController', () => {
  const controller = new AppController();

  it('answers the health probe without touching any upstream service', () => {
    expect(controller.health()).toMatchObject({ ok: true });
  });

  it('names the tools it serves', () => {
    expect(controller.root()).toEqual({ name: 'Openkit', tools: ['leads'] });
  });
});
