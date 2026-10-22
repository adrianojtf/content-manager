export async function syncPublicationPage(publications, syncOne, onProgress = () => {}) {
  const results = [];
  for (const publication of publications) {
    onProgress({ completed: results.length, total: publications.length, current: publication });
    try {
      results.push({ publication, result: await syncOne(publication) });
    } catch (error) {
      results.push({ publication, result: { success: false }, error });
    }
    onProgress({
      completed: results.length,
      total: publications.length,
      current: publication,
      result: results.at(-1).result,
    });
  }
  return results;
}
