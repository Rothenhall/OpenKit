import { SarvamService, normalizeForSpeech } from './sarvam.service.js';
import { isBuiltInVoice, isCustomVoice } from './voices.js';

const KUNAL = 'svc-7328ae60-68dd-473d-b450-e33481be976f';

function mockVoicesApi() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/voices')) {
      return Response.json({
        data: {
          voices: [
            { id: KUNAL, name: 'Kunal', status: 'active' },
            { id: 'svc-old', name: 'Old', status: 'archived' },
          ],
        },
      });
    }
    return Response.json({ audio: 'QUJD' });
  });
}

describe('voice ids', () => {
  it('tells saved platform voices from built in speakers', () => {
    expect(isCustomVoice(KUNAL)).toBe(true);
    expect(isCustomVoice('priya')).toBe(false);
    expect(isBuiltInVoice('priya')).toBe(true);
    expect(isBuiltInVoice('kunal')).toBe(false);
  });
});

describe('normalizeForSpeech', () => {
  it('strips markdown and groups long numbers for the voice', () => {
    expect(normalizeForSpeech('**Hello**, see *this* #now')).toBe(
      'Hello, see this now',
    );
    expect(normalizeForSpeech('we serve 10000 teams')).toBe(
      'we serve 10,000 teams',
    );
    expect(normalizeForSpeech('  too   much\nspace ')).toBe('too much space');
  });
});

describe('SarvamService voices', () => {
  beforeEach(() => {
    process.env.SARVAM_API_KEY = 'test-key';
  });
  afterEach(() => vi.restoreAllMocks());

  it('resolves a saved voice by name ignoring case, and caches the list', async () => {
    const fetchSpy = mockVoicesApi();
    const sarvam = new SarvamService();
    expect(await sarvam.resolveVoice('KUNAL')).toBe(KUNAL);
    expect(await sarvam.resolveVoice('kunal')).toBe(KUNAL);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to built in speakers and rejects unknown or archived names', async () => {
    mockVoicesApi();
    const sarvam = new SarvamService();
    expect(await sarvam.resolveVoice('priya')).toBe('priya');
    await expect(sarvam.resolveVoice('old')).rejects.toThrow('No voice called');
    await expect(sarvam.resolveVoice('nobody')).rejects.toThrow(
      'No voice called',
    );
  });

  it('speaks a saved voice through the clone endpoint with form fields', async () => {
    const fetchSpy = mockVoicesApi();
    const audio = await new SarvamService().synthesize('Hello', 'en-IN', KUNAL);
    expect(audio).toBe('QUJD');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://api.sarvam.ai/voices/clone');
    const form = (init as RequestInit).body as FormData;
    expect(form.get('voice_id')).toBe(KUNAL);
    expect(form.get('text')).toBe('Hello');
    expect(form.get('language_code')).toBe('en-IN');
  });

  it('runs task prompts on the V2 task model as JSON', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        Response.json({ choices: [{ message: { content: '{"a":1}' } }] }),
      );
    const text = await new SarvamService().chatTask(
      [{ role: 'user', content: 'hi' }],
      { json: true },
    );
    expect(text).toBe('{"a":1}');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://api.sarvam.ai/v2/chat/completions');
    const request = init as RequestInit;
    expect(JSON.parse(String(request.body)).model).toBe('glm5.3');
    expect(JSON.parse(String(request.body)).response_format).toEqual({
      type: 'json_object',
    });
    expect(request.headers).toMatchObject({
      'Content-Type': 'application/json',
      'api-subscription-key': 'test-key',
    });
  });
});

describe('ttsLanguageFor', () => {
  it('keeps the call language for romanised Indic text', async () => {
    const { ttsLanguageFor } = await import('./languages.js');
    expect(ttsLanguageFor('Haan, do minute hain. Bolo.', 'hi-IN')).toBe('hi-IN');
    expect(ttsLanguageFor('Hello, who is this?', 'hi-IN')).toBe('en-IN');
    expect(ttsLanguageFor('Haan, do minute hain.', 'en-IN')).toBe('en-IN');
    expect(ttsLanguageFor('नमस्ते, आप कैसे हैं', 'hi-IN')).toBe('hi-IN');
  });
});
