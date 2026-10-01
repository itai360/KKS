// web-push for the browser demo: phone notifications need a real server.
const webpush = {
  generateVAPIDKeys: () => ({ publicKey: 'demo', privateKey: 'demo' }),
  setVapidDetails: () => undefined,
  sendNotification: async () => ({ statusCode: 201 }),
};
export default webpush;
export const { generateVAPIDKeys, setVapidDetails, sendNotification } = webpush;
