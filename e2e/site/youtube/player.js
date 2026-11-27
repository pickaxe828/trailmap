// Stands in for the player: a canvas stream plays without any media file, so `paused` and `ended` behave like a real video.
const canvas = document.createElement('canvas');
canvas.width = canvas.height = 16;
const context = canvas.getContext('2d');
setInterval(() => { context.fillStyle = `hsl(${Date.now() % 360} 80% 50%)`; context.fillRect(0, 0, 16, 16); }, 50);
const video = document.querySelector('video');
video.srcObject = canvas.captureStream(10);
window.fixturePlay = () => video.play();
window.fixturePause = () => video.pause();
