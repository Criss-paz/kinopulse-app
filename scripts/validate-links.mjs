import fs from 'fs';
import fetch from 'node-fetch';

async function validateCatalog() {
  console.log('🔍 Iniciando validación de enlaces del catálogo...');
  const data = JSON.parse(fs.readFileSync('./src/data/catalog.json', 'utf8'));
  const movies = data.movies;
  let failed = 0;

  for (const movie of movies) {
    try {
      const response = await fetch(movie.stream, { method: 'HEAD', timeout: 5000 });
      if (response.ok) {
        console.log(`✅ OK: ${movie.title}`);
      } else {
        console.error(`❌ FAIL (${response.status}): ${movie.title} - ${movie.stream}`);
        failed++;
      }
    } catch (err) {
      console.error(`❌ ERROR: ${movie.title} - ${err.message}`);
      failed++;
    }
  }

  console.log(`\n--- Resultado Final ---`);
  console.log(`Total películas: ${movies.length}`);
  console.log(`Enlaces caídos: ${failed}`);
  if (failed > 0) process.exit(1);
}

validateCatalog().catch(err => {
  console.error('Error crítico en validador:', err);
  process.exit(1);
});
