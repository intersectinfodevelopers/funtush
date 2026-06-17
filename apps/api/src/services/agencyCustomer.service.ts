import { BookingStatus, db, Prisma } from "@funtush/database";

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

export const agencyCustomerListService = async (agencyId: string, query: customersQuery,) => {

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

  const bookingWhere: Prisma.BookingWhereInput = {
    agencyId,
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
   * STEP 1
   * Aggregate bookings by trekker
   */
  const groupedCustomers = await db.booking.groupBy({
    by: ["trekkerId"],

    where: bookingWhere,

    _count: {
      id: true,
    },

    _sum: {
      totalPrice: true,
    },

    _max: {
      createdAt: true,
    },
  });

  if (!groupedCustomers.length) {
    return {
      data: [],
      meta: {
        page,
        limit,
        total: 0,
        totalPages: 0,
      },
    };
  }

  /**
 * Remove bookings that are not linked to a trekker
 */
  const groupedCustomersWithTrekker = groupedCustomers.filter(
    (
      customer,
    ): customer is typeof customer & { trekkerId: string } =>
      customer.trekkerId !== null,
  );

  /**
   * STEP 2
   * Fetch trekker details
   */
  const trekkerIds = groupedCustomersWithTrekker.map(
    (customer) => customer.trekkerId,
  );

  const trekkers = await db.trekker.findMany({
    where: {
      id: {
        in: trekkerIds
      },
    },

    select: {
      id: true,
      fullName: true,
      phone: true,
      country: true,

      user: {
        select: {
          email: true,
        },
      },
    },
  });

  const trekkerMap = new Map(
    trekkers.map((trekker) => [trekker.id, trekker]),
  );

  /**
   * STEP 3
   * Merge aggregation + trekker details
   */
  let customers = groupedCustomersWithTrekker.map((customer) => {

    const trekker = trekkerMap.get(customer.trekkerId);

    const totalBookings = customer._count.id;
    const totalSpending = customer._sum.totalPrice
      ? Number(customer._sum.totalPrice)
      : 0;
    const lastBookingDate = customer._max.createdAt;

    return {
      trekkerId: customer.trekkerId,

      fullName: trekker?.fullName ?? null,
      email: trekker?.user.email ?? null,
      phone: trekker?.phone ?? null,
      country: trekker?.country ?? null,

      totalBookings,
      totalSpending,
      lastBookingDate,

      repeatVisitor: totalBookings > 1,
      isNewCustomer: totalBookings === 1,
    };
  });

  /**
   * STEP 4
   * Search
   */
  if (search?.trim()) {
    const keyword = search.toLowerCase();

    customers = customers.filter((customer) => {
      return (
        customer.fullName
          ?.toLowerCase()
          .includes(keyword) ||
        customer.email
          ?.toLowerCase()
          .includes(keyword) ||
        customer.phone
          ?.toLowerCase()
          .includes(keyword)
      );
    });
  }

  /**
   * STEP 5
   * Repeat / New filter
   */
  if (customerType === "repeat") {
    customers = customers.filter(
      (customer) => customer.repeatVisitor,
    );
  }

  if (customerType === "new") {
    customers = customers.filter(
      (customer) => !customer.repeatVisitor,
    );
  }

  /**
   * STEP 6
   * Sorting
   */
  customers.sort((a, b) => {

    switch (sortBy) {
      case "totalBookings":
        return a.totalBookings - b.totalBookings;

      case "totalSpending":
        return a.totalSpending - b.totalSpending;

      case "lastBookingDate":
      default:
        return (
          new Date(a.lastBookingDate ?? 0).getTime() -
          new Date(b.lastBookingDate ?? 0).getTime()
        );
    }
  });

  if (sortOrder === "desc") {
    customers.reverse();
  }

  /**
   * STEP 7
   * Pagination
   */
  const total = customers.length;

  const start = Number(page - 1) * Number(limit);

  const paginatedCustomers = customers.slice(
    start,
    start + limit,
  );

  return {
    data: paginatedCustomers,

    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}



/**
 Agency staff - add private note about customers
 */
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
    throw new Error("Booking not found");
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

  return {
    success: true,
    message: "Customer profile fetched successfully",
    data: {
      customer,

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

  const totalCustomers = trekkers.length;

  const newCustomers = trekkers.filter(
    (t) => t.bookings.length === 1
  );

  const returningCustomers = trekkers.filter(
    (t) => t.bookings.length > 1
  );

  const repeatRate =
    totalCustomers > 0
      ? (returningCustomers.length / totalCustomers) * 100
      : 0;

  const newVsReturningRatio =
    returningCustomers.length > 0
      ? `${newCustomers.length}:${returningCustomers.length}`
      : `${newCustomers.length}:0`;

  const topCustomersBySpending = trekkers
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
    })
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


