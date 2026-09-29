import { BookingStatus, db, Prisma } from "@funtush/database";
import { applyOverrides, guestProfile, hasGuestCustomers, hiddenCustomerKeys, isGuestKey, unifiedCustomerList } from "./agencyCustomerRecords.service";

interface customersQuery {
  page?: number;
  limit?: number;
  search?: string;
  customerType?: "repeat" | "new";
  destination?: string;
  bookingStatus?: BookingStatus;
  sortBy?: "lastBookingDate" | "totalBookings" | "totalSpending";
  sortOrder?: "asc" | "desc";
}

/**
 * Customers list. The common case (no booking-status / destination filter) is
 * answered from `agency_customer_stats` — one row per customer, kept current by
 * a database trigger — so cost is O(page), independent of how many bookings the
 * agency has. Those two filters need per-booking dimensions the summary
 * doesn't carry, so they fall back to aggregating the agency's bookings.
 */
export const agencyCustomerListService = async (agencyId: string, query: customersQuery) => {
  const filtered = Boolean(query.bookingStatus || query.destination);
  // Guests (completed a trek without an account) are customers too — the list then has to merge two sources.
  if (!filtered && (await hasGuestCustomers(agencyId))) {
    const { page = 1, limit = 20, search, customerType, sortBy = "lastBookingDate", sortOrder = "desc" } = query;
    return unifiedCustomerList(agencyId, { page, limit, search, customerType, sortBy, sortOrder });
  }
  const hidden = [...(await hiddenCustomerKeys(agencyId))].filter((k) => !isGuestKey(k));
  const res = await agencyCustomerListCore(agencyId, query, hidden);
  return { ...res, data: await applyOverrides(agencyId, res.data.map((r) => ({ ...r, isGuest: false }))) };
};

async function agencyCustomerListCore(agencyId: string, query: customersQuery, hidden: string[]) {
  if (query.bookingStatus || query.destination) {
    return agencyCustomerListFromBookings(agencyId, query, hidden);
  }

  const { page = 1, limit = 20, search, customerType, sortBy = "lastBookingDate", sortOrder = "desc" } = query;
  const dir: Prisma.SortOrder = sortOrder === "asc" ? "asc" : "desc";

  // Substring search of 3+ characters can use the trigram indexes, but only
  // when name/phone and email are looked up as separate index probes — an
  // `OR` spanning trekker and users forces a scan of both tables. Shorter
  // terms match too much for an index to help, so they take the plain path.
  if (search && search.trim().length >= 3) {
    return searchCustomersViaTrigram(agencyId, { page, limit, search: search.trim(), customerType, sortBy, sortOrder, hidden });
  }

  const where: Prisma.AgencyCustomerStatWhereInput = {
    agencyId,
    ...(hidden.length ? { trekkerId: { notIn: hidden } } : {}),
    ...(customerType === "repeat" ? { totalBookings: { gt: 1 } } : {}),
    ...(customerType === "new" ? { totalBookings: 1 } : {}),
    ...(search?.trim()
      ? {
          trekker: {
            OR: [
              { fullName: { contains: search.trim(), mode: "insensitive" } },
              { phone: { contains: search.trim(), mode: "insensitive" } },
              { user: { email: { contains: search.trim(), mode: "insensitive" } } },
            ],
          },
        }
      : {}),
  };

  const primary: Prisma.AgencyCustomerStatOrderByWithRelationInput =
    sortBy === "totalBookings"
      ? { totalBookings: dir }
      : sortBy === "totalSpending"
        ? { totalSpent: dir }
        : { lastBookingAt: dir };

  const [rows, total] = await Promise.all([
    db.agencyCustomerStat.findMany({
      where,
      orderBy: [primary, { trekkerId: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        trekker: { select: { fullName: true, phone: true, country: true, user: { select: { email: true } } } },
      },
    }),
    db.agencyCustomerStat.count({ where }),
  ]);

  return {
    data: rows.map((r) => ({
      trekkerId: r.trekkerId,
      fullName: r.trekker.fullName ?? null,
      email: r.trekker.user.email ?? null,
      phone: r.trekker.phone ?? null,
      country: r.trekker.country ?? null,
      totalBookings: r.totalBookings,
      totalSpending: Number(r.totalSpent),
      lastBookingDate: r.lastBookingAt,
      repeatVisitor: r.totalBookings > 1,
      isNewCustomer: r.totalBookings === 1,
    })),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * Search path for 3+ character terms. Matching trekker ids are resolved per
 * table (each probe can use its own trigram index), unioned, then intersected
 * with this agency's customer rows.
 */
async function searchCustomersViaTrigram(
  agencyId: string,
  q: { page: number; limit: number; search: string; customerType?: "repeat" | "new"; sortBy: string; sortOrder: string; hidden: string[] },
) {
  // LIKE metacharacters in user input must match literally
  const pattern = `%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const dirSql = q.sortOrder === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  // column names come from a fixed whitelist, never from input
  const sortCol =
    q.sortBy === "totalBookings" ? Prisma.sql`s.total_bookings` : q.sortBy === "totalSpending" ? Prisma.sql`s.total_spent` : Prisma.sql`s.last_booking_at`;
  const typeSql =
    q.customerType === "repeat" ? Prisma.sql`AND s.total_bookings > 1` : q.customerType === "new" ? Prisma.sql`AND s.total_bookings = 1` : Prisma.empty;

  const hiddenSql = q.hidden.length ? Prisma.sql`AND s.trekker_id NOT IN (${Prisma.join(q.hidden)})` : Prisma.empty;
  const matches = Prisma.sql`
    matches AS (
      SELECT id FROM trekker WHERE "fullName" ILIKE ${pattern} OR phone ILIKE ${pattern}
      UNION
      SELECT t.id FROM users u JOIN trekker t ON t.user_id = u.id WHERE u.email ILIKE ${pattern}
    )`;

  type Row = {
    trekker_id: string; total_bookings: number; total_spent: Prisma.Decimal; last_booking_at: Date;
    full_name: string | null; phone: string | null; country: string | null; email: string | null;
  };
  const [rows, countRows] = await Promise.all([
    db.$queryRaw<Row[]>(Prisma.sql`
      WITH ${matches}
      SELECT s.trekker_id, s.total_bookings, s.total_spent, s.last_booking_at,
             t."fullName" AS full_name, t.phone, t.country, u.email
        FROM agency_customer_stats s
        JOIN matches m ON m.id = s.trekker_id
        JOIN trekker t ON t.id = s.trekker_id
        JOIN users u ON u.id = t.user_id
       WHERE s.agency_id = ${agencyId} ${typeSql} ${hiddenSql}
       ORDER BY ${sortCol} ${dirSql}, s.trekker_id ASC
       LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`),
    db.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      WITH ${matches}
      SELECT count(*) AS n
        FROM agency_customer_stats s JOIN matches m ON m.id = s.trekker_id
       WHERE s.agency_id = ${agencyId} ${typeSql} ${hiddenSql}`),
  ]);

  const total = Number(countRows[0]?.n ?? 0);
  return {
    data: rows.map((r) => ({
      trekkerId: r.trekker_id,
      fullName: r.full_name,
      email: r.email,
      phone: r.phone,
      country: r.country,
      totalBookings: r.total_bookings,
      totalSpending: Number(r.total_spent),
      lastBookingDate: r.last_booking_at,
      repeatVisitor: r.total_bookings > 1,
      isNewCustomer: r.total_bookings === 1,
    })),
    meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
  };
}

/** The aggregate-every-booking path: exact, but O(bookings). Kept for the filters the summary can't answer. */
export const agencyCustomerListFromBookings = async (agencyId: string, query: customersQuery, hidden: string[] = []) => {

  const {
    page = 1,
    limit = 20,
    search,
    destination,
    bookingStatus,
    customerType,
    sortBy = "lastBookingDate",
    sortOrder = "desc",
  } = query;

  // A "customer" is a trekker with at least one booking at this agency.
  const bookingWhere: Prisma.BookingWhereInput = {
    agencyId,
    trekkerId: hidden.length ? { not: null, notIn: hidden } : { not: null },
  };

  if (bookingStatus) {
    bookingWhere.status = bookingStatus;
  }

  if (destination) {
    bookingWhere.package = {
      destinations: {
        some: {
          id: destination,
        },
      },
    };
  }

  /**
   * Search runs in the database, against trekker name / phone / email, and
   * narrows the booking set to those trekkers. (This used to load every
   * trekker row and substring-match in JS.) Only ids come back.
   */
  if (search?.trim()) {
    const keyword = search.trim();
    const matches = await db.trekker.findMany({
      where: {
        bookings: { some: bookingWhere },
        OR: [
          { fullName: { contains: keyword, mode: "insensitive" } },
          { phone: { contains: keyword, mode: "insensitive" } },
          { user: { email: { contains: keyword, mode: "insensitive" } } },
        ],
      },
      select: { id: true },
    });
    bookingWhere.trekkerId = { in: matches.map((t) => t.id) };
  }

  // repeat = more than one booking, new = exactly one — a HAVING on the group.
  const having: Prisma.BookingScalarWhereWithAggregatesInput | undefined =
    customerType === "repeat"
      ? { id: { _count: { gt: 1 } } }
      : customerType === "new"
        ? { id: { _count: { equals: 1 } } }
        : undefined;

  // Sort by the aggregate itself, with trekkerId as a tie-breaker so page
  // boundaries are stable (otherwise equal rows can repeat/vanish across pages).
  const dir: Prisma.SortOrder = sortOrder === "asc" ? "asc" : "desc";
  const primarySort =
    sortBy === "totalBookings"
      ? ({ _count: { id: dir } } as const)
      : sortBy === "totalSpending"
        ? ({ _sum: { totalPrice: dir } } as const)
        : ({ _max: { createdAt: dir } } as const);

  const [groupedPage, total] = await Promise.all([
    // one page of aggregates, sorted + sliced by Postgres
    db.booking.groupBy({
      by: ["trekkerId"],
      where: bookingWhere,
      having,
      orderBy: [primarySort, { trekkerId: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
      _count: { id: true },
      _sum: { totalPrice: true },
      _max: { createdAt: true },
    }),
    // How many customers match. Without a repeat/new filter that's a plain
    // COUNT in Postgres; only the HAVING case needs the per-trekker groups
    // (previously this ALWAYS pulled every group into Node just to count them).
    having
      ? db.booking.groupBy({ by: ["trekkerId"], where: bookingWhere, having }).then((g) => g.length)
      : db.trekker.count({ where: { bookings: { some: bookingWhere } } }),
  ]);

  if (groupedPage.length === 0) {
    return { data: [], meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  // Trekker details for THIS PAGE only (up to `limit` rows, not every customer).
  const pageTrekkerIds = groupedPage.flatMap((g) => (g.trekkerId ? [g.trekkerId] : []));
  const trekkers = await db.trekker.findMany({
    where: { id: { in: pageTrekkerIds } },
    select: {
      id: true,
      fullName: true,
      phone: true,
      country: true,
      user: { select: { email: true } },
    },
  });
  const trekkerMap = new Map(trekkers.map((t) => [t.id, t]));

  const data = groupedPage.map((g) => {
    const trekker = trekkerMap.get(g.trekkerId as string);
    const totalBookings = g._count.id;

    return {
      trekkerId: g.trekkerId as string,

      fullName: trekker?.fullName ?? null,
      email: trekker?.user.email ?? null,
      phone: trekker?.phone ?? null,
      country: trekker?.country ?? null,

      totalBookings,
      totalSpending: g._sum.totalPrice ? Number(g._sum.totalPrice) : 0,
      lastBookingDate: g._max.createdAt,

      repeatVisitor: totalBookings > 1,
      isNewCustomer: totalBookings === 1,
      isGuest: false,
    };
  });

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

interface customerNoteInput {
  noteText: string;
}

export const customerNoteService = async (
  data: customerNoteInput,
  customerId: string,
  staffId: string,
  agencyId: string
) => {
  const {
    noteText
  } = data;

  if (isGuestKey(customerId)) {
    throw Object.assign(new Error("Notes need the customer to have a Funtush account. This guest doesn't have one."), { status: 400 });
  }

  // Only for a real customer of THIS agency (a trekker with a booking here).
  // Otherwise any agency could attach notes to any trekker id on the platform,
  // and the 200-vs-500 difference told them which ids exist.
  const isCustomer = await db.booking.findFirst({
    where: { agencyId, trekkerId: customerId },
    select: { id: true },
  });
  if (!isCustomer) {
    const err = new Error("Customer not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  const customerNote = await db.customerNote.create({
    data: {
      trekkerId: customerId,
      staffId,
      noteText,
      agencyId,
    },
  });

  return {
    success: true,
    message: "Customer note added successfully",
    data: {
      customerNote
    },
  };
};



/**
 Agencies are able to see the private note created by staffs. 
 */
export const getCustomerNoteService = async (
  customerId: string,
  agencyId: string
) => {

  const customerNote = await db.customerNote.findMany({
    where: {
      trekkerId: customerId,
      agencyId: agencyId
    },
    orderBy: {
      createdAt: "desc", // newest first
    },
  });


  return {
    success: true,
    message: "Customer Notes",
    data: {
      customerNote
    },
  };
};



/**
 Agency -> gets customer profile
 */
export const agencyGetCustomersProfileService = async (
  customerId: string,
  agencyId: string
) => {

  if (isGuestKey(customerId)) {
    const guest = await guestProfile(customerId, agencyId);
    if (!guest) throw Object.assign(new Error("Customer not found"), { status: 404 });
    return guest;
  }

  const customer = await db.trekker.findFirst({
    where: {
      id: customerId,
      bookings: {
        some: {
          agencyId,
        },
      },
    },
    include: {
      user: {
        select: {
          email: true,
        },
      },
      preference: true,
    },
  });

  // if (!customer) {
  //   throw new Error("Customer not found");
  // }


  const bookings = await db.booking.findMany({
    where: {
      agencyId,
      trekkerId: customerId,
    },
    include: {
      package: {
        select: {
          id: true,
          title: true,
          destinations: {
            select: {
              name: true,
            },
          },
        },
      },
      paymentLink: {
        select: {
          id: true
        }
      }
    },
    orderBy: {
      createdAt: "desc",
    },
  });


  if (!bookings.length) {
    // Not one of THIS agency's customers (or no such trekker) — same answer for both,
    // so ids can't be probed. It used to be a plain Error, i.e. a 500.
    throw Object.assign(new Error("Customer not found"), { status: 404 });
  }

  const notes = await db.customerNote.findMany({
    where: {
      agencyId,
      trekkerId: customerId,
    },
    include: {
      staff: {
        include: {
          user: {
            select: {
              email: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });


  const totalSpent = bookings.reduce(
    (sum, booking) => sum + Number(booking.totalPrice || 0),
    0
  );

  const visitCount = bookings.length;

  const firstBookingDate =
    bookings.length > 0
      ? bookings[bookings.length - 1].createdAt
      : null;

  const lastBookingDate =
    bookings.length > 0
      ? bookings[0].createdAt
      : null;

  const averageBookingValue =
    visitCount > 0 ? totalSpent / visitCount : 0;

  const preferredDestinations = await db.trekkerPreference.findMany({
    where: {
      trekkerId: customerId
    },
    select: {
      preferredDestinations: true
    }
  })

  const loyalityFlag = visitCount >= 3;

  const over = await db.agencyCustomerOverride.findUnique({ where: { agencyId_customerKey: { agencyId, customerKey: customerId } } });

  return {
    success: true,
    message: "Customer profile fetched successfully",
    data: {
      customer: customer && over ? { ...customer, fullName: over.fullName ?? customer.fullName, phone: over.phone ?? customer.phone, country: over.country ?? customer.country, user: { ...customer.user, email: over.email ?? customer.user.email } } : customer,

      stats: {
        totalSpent,
        visitCount,
        firstBookingDate,
        lastBookingDate,
        averageBookingValue,
        preferredDestinations,
        badge: loyalityFlag ? "Loyal Customer" : null,
      },

      bookingHistory: bookings,
      notes,
    },
  };
};


/**
 Agency -> gets customer analytics
 */
export const customerAnalyticsService = async (  //— top customers by spending, repeat rate, new vs returning ratio
  agencyId: string
) => {

  const trekkers = await db.trekker.findMany({
    where: {
      bookings: {
        some: {
          agencyId,
        },
      },
    },
    include: {
      bookings: {
        where: { agencyId },
        select: {
          totalPrice: true,
          createdAt: true,
        },
      },
    },
  });

  // The customer list = linked trekkers + guests who completed a trek, minus the ones the agency removed.
  const hidden = await hiddenCustomerKeys(agencyId);
  const guestRows = await db.$queryRaw<{ email: string; name: string | null; n: number; spent: Prisma.Decimal }[]>(Prisma.sql`
    SELECT lower(trekker_email) AS email, (array_agg(trekker_name ORDER BY created_at DESC))[1] AS name, count(*)::int AS n, sum(total_price) AS spent
      FROM bookings WHERE agency_id = ${agencyId} AND trekker_id IS NULL AND status = 'COMPLETED' GROUP BY lower(trekker_email)`);
  const visibleTrekkers = trekkers.filter((t) => !hidden.has(t.id));
  const guests = guestRows.filter((g) => !hidden.has(`guest:${g.email}`));

  const totalCustomers = visibleTrekkers.length + guests.length;

  const newCustomers = [
    ...visibleTrekkers.filter((t) => t.bookings.length === 1),
    ...guests.filter((g) => g.n === 1),
  ];

  const returningCustomers = [
    ...visibleTrekkers.filter((t) => t.bookings.length > 1),
    ...guests.filter((g) => g.n > 1),
  ];

  const repeatRate =
    totalCustomers > 0
      ? (returningCustomers.length / totalCustomers) * 100
      : 0;

  const newVsReturningRatio =
    returningCustomers.length > 0
      ? `${newCustomers.length}:${returningCustomers.length}`
      : `${newCustomers.length}:0`;

  const topCustomersBySpending = [
    ...guests.map((g) => ({ trekkerId: `guest:${g.email}`, name: g.name, totalSpent: Number(g.spent), bookingCount: g.n })),
    ...visibleTrekkers
    .map((t) => {
      const totalSpent = (t.bookings || []).reduce(
        (sum, b) => sum + Number(b.totalPrice || 0),
        0
      );

      const bookingCount = t.bookings.length

      return {
        trekkerId: t.id,
        name: t.fullName,
        totalSpent,
        bookingCount,
      };
    }),
  ]
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 10);


  return {
    data: {
      agency: agencyId,
      totalCustomers: totalCustomers,
      newCustomers: newCustomers.length,
      returningCustomers: returningCustomers.length,
      repeatRate: repeatRate,
      newVsReturningRatio: newVsReturningRatio,
      topCustomersBySpending: topCustomersBySpending,
    },
  };
};


