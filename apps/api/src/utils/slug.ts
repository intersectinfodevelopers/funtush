export const generateSlug = async (company_name: string, pool: any) => {

  const baseSlug = company_name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-');        // Replace spaces with single dashes

  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const result = await pool.query(
      "SELECT * FROM agency WHERE slug = $1",
      [slug]
    );

    if (result.rows.length === 0) {
      return slug;
    }

    counter++;
    slug = `${baseSlug}${counter}`;
  }
};