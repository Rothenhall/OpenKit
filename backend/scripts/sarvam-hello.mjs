import { SarvamAIClient } from 'sarvamai';

process.loadEnvFile();

const client = new SarvamAIClient({
  apiSubscriptionKey: process.env.SARVAM_API_KEY,
});

const response = await client.chat.completions({
  model: 'sarvam-105b-conversations',
  messages: [{ role: 'user', content: 'Say hello in one short sentence.' }],
});

console.log(response.choices[0].message.content);
