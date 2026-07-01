import { app } from './app';

async function bootstrap() {
  
  await app.listen();
}

bootstrap().catch(err => {
  console.error(err);
  process.exit(1);
});