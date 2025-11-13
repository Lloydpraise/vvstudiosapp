/**
 * Groups sales documents by month.
 * @param {Array<Object>} salesDocs - An array of sales objects from Supabase query.
 * @returns {Map<string, number>} A map where the key is the month ("YYYY-MM") and the value is the total revenue for that month.
 */
function groupSalesByMonth(salesDocs) {
    const salesByMonth = new Map();

    salesDocs.forEach(sale => {
        if (!sale.timestamp || typeof sale.amount !== 'number') return;

        const saleDate = new Date(sale.timestamp); // Assuming timestamp is ISO string from Supabase
        const monthKey = `${saleDate.getFullYear()}-${String(saleDate.getMonth() + 1).padStart(2, '0')}`; // "YYYY-MM"

        if (!salesByMonth.has(monthKey)) {
            salesByMonth.set(monthKey, 0);
        }
        salesByMonth.set(monthKey, salesByMonth.get(monthKey) + sale.amount);
    });

    return salesByMonth;
}

/**
 * Processes an array of sales objects from Supabase to calculate key business metrics.
 * @param {Array<Object>} salesDocs - An array of sales objects from Supabase query.
 * @param {number} totalLeads - The total number of leads for the period, used for conversion rate.
 * @returns {Object} An object containing calculated metrics like total revenue, AOV, etc.
 */
export function processSalesData(salesDocs, totalLeads = 5) {
    if (!salesDocs || salesDocs.length === 0) {
        return {
            totalRevenue: 0, revenueChange: 0, salesToday: 0, averageOrderValue: 0,
            bestSellingProducts: [], conversionRate: 0, monthlyRevenueTrend: []
        };
    }

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    let totalRevenueAllTime = 0;
    const productCounts = new Map();
    const uniqueCustomers = new Set();

    // --- Step 1: Group all sales data by month ---
    const salesByMonth = groupSalesByMonth(salesDocs);

    // Ensure previous month is included in calculations
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthKey = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;

    if (!salesByMonth.has(prevMonthKey)) {
        salesByMonth.set(prevMonthKey, 0);
    }

    // --- Step 2: Calculate all-time stats and other metrics ---
    salesDocs.forEach(sale => {
        if (!sale.timestamp || typeof sale.amount !== 'number') return;

        // Calculate all-time totals for AOV
        totalRevenueAllTime += sale.amount;

        // Aggregate product counts for best-sellers
        if (sale.products && Array.isArray(sale.products)) {
            sale.products.forEach(productName => {
                productCounts.set(productName, (productCounts.get(productName) || 0) + 1);
            });
        }

        // Collect unique customers for conversion rate
        if (sale.user_id) {
            uniqueCustomers.add(sale.user_id);
        }
    });

    // --- Step 3: Calculate metrics from the grouped and aggregated data ---

    const thisMonthSales = salesByMonth.get(currentMonthKey) || 0;
    const lastMonthSales = salesByMonth.get(prevMonthKey) || 0;

    // Calculate Sales Today by filtering the original docs
    const salesToday = salesDocs.reduce((acc, sale) => {
        const saleDateStr = new Date(sale.timestamp).toISOString().split('T')[0];
        return saleDateStr === todayStr ? acc + sale.amount : acc;
    }, 0);

    // Revenue Change (%)
    let revenueChange;
    if (lastMonthSales > 0) {
        revenueChange = (((thisMonthSales - lastMonthSales) / lastMonthSales) * 100);
    } else {
        revenueChange = thisMonthSales > 0 ? 100.0 : 0.0;
    }

    // Average Order Value (based on all orders)
    const averageOrderValue = salesDocs.length > 0 ? totalRevenueAllTime / salesDocs.length : 0;

    // Best Selling Products
    const bestSellingProducts = Array.from(productCounts.entries())
        .map(([name, units]) => ({ name, units }))
        .sort((a, b) => b.units - a.units)
        .slice(0, 5);

    // Conversion Rate
    const conversionRate = totalLeads > 0 ? ((uniqueCustomers.size / totalLeads) * 100) : 0;

    // Format data for the monthly revenue chart
    const monthlyRevenueTrend = Array.from(salesByMonth.entries())
        .map(([month, revenue]) => ({ month, revenue }))
        .sort((a, b) => a.month.localeCompare(b.month));

    return {
        totalRevenue: thisMonthSales,
        revenueChange: revenueChange.toFixed(1),
        salesToday,
        averageOrderValue,
        bestSellingProducts,
        conversionRate: conversionRate.toFixed(1),
        monthlyRevenueTrend
    };
}
