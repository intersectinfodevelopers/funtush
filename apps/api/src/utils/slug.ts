type PrismaLike = {
  agency: {
    findUnique: (args: {
      where: { slug: string };
    }) => Promise<{ slug: string } | null>;
  };
};

export const generateSlug = async (name: string,
  prisma: PrismaLike): Promise<string> => {

  const baseSlug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-');        // Replace spaces with single dashes

  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const existing = await prisma.agency.findUnique({
      where: { slug },
    });

    if (!existing) break;

  
    counter++;
    slug = `${baseSlug}-${counter}`;
  }

  return slug;
};