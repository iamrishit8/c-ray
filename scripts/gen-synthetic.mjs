// `npm run gen:synthetic -- 10000 [out.zip]`: writes a synthetic project ZIP (see synthetic.mjs).
import { main } from './synthetic.mjs';

main(process.argv.slice(2)).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
