export interface BuiltinCategory {
  id: string;
  name: string;
  parent?: string; // parent category name; undefined = top-level
}

/**
 * Built-in category taxonomy. These are seeded into the `categories` table
 * on first migration and cannot be deleted by users.
 *
 * IDs use a stable slug format so re-seeding is idempotent.
 */
export const BUILTIN_CATEGORIES: BuiltinCategory[] = [
  // --- Top-level categories ---
  { id: 'cat_food',       name: 'Food & Dining' },
  { id: 'cat_transport',  name: 'Transport' },
  { id: 'cat_housing',    name: 'Housing' },
  { id: 'cat_health',     name: 'Health' },
  { id: 'cat_ent',        name: 'Entertainment' },
  { id: 'cat_shopping',   name: 'Shopping' },
  { id: 'cat_personal',   name: 'Personal Care' },
  { id: 'cat_edu',        name: 'Education' },
  { id: 'cat_income',     name: 'Income' },
  { id: 'cat_savings',    name: 'Savings & Investments' },
  { id: 'cat_transfers',  name: 'Transfers' },
  { id: 'cat_other',      name: 'Other' },

  // --- Food & Dining subcategories ---
  { id: 'cat_food_grocery',    name: 'Groceries',      parent: 'Food & Dining' },
  { id: 'cat_food_restaurant', name: 'Restaurants',    parent: 'Food & Dining' },
  { id: 'cat_food_coffee',     name: 'Coffee',         parent: 'Food & Dining' },

  // --- Transport subcategories ---
  { id: 'cat_transport_gas',     name: 'Gas',            parent: 'Transport' },
  { id: 'cat_transport_parking', name: 'Parking',        parent: 'Transport' },
  { id: 'cat_transport_transit', name: 'Public Transit', parent: 'Transport' },
  { id: 'cat_transport_ride',    name: 'Rideshare',      parent: 'Transport' },

  // --- Housing subcategories ---
  { id: 'cat_housing_rent',      name: 'Rent/Mortgage',  parent: 'Housing' },
  { id: 'cat_housing_utilities', name: 'Utilities',      parent: 'Housing' },
  { id: 'cat_housing_internet',  name: 'Internet',       parent: 'Housing' },
  { id: 'cat_housing_insurance', name: 'Insurance',      parent: 'Housing' },

  // --- Health subcategories ---
  { id: 'cat_health_medical',   name: 'Medical',    parent: 'Health' },
  { id: 'cat_health_pharmacy',  name: 'Pharmacy',   parent: 'Health' },
  { id: 'cat_health_fitness',   name: 'Fitness',    parent: 'Health' },

  // --- Entertainment subcategories ---
  { id: 'cat_ent_streaming', name: 'Streaming', parent: 'Entertainment' },
  { id: 'cat_ent_games',     name: 'Games',      parent: 'Entertainment' },
  { id: 'cat_ent_movies',    name: 'Movies',     parent: 'Entertainment' },

  // --- Shopping subcategories ---
  { id: 'cat_shop_clothing',     name: 'Clothing',     parent: 'Shopping' },
  { id: 'cat_shop_electronics',  name: 'Electronics',  parent: 'Shopping' },
  { id: 'cat_shop_home',         name: 'Home Goods',   parent: 'Shopping' },

  // --- Personal Care subcategories ---
  { id: 'cat_personal_haircut', name: 'Haircut', parent: 'Personal Care' },
  { id: 'cat_personal_beauty',  name: 'Beauty',  parent: 'Personal Care' },

  // --- Education subcategories ---
  { id: 'cat_edu_tuition', name: 'Tuition', parent: 'Education' },
  { id: 'cat_edu_books',   name: 'Books',   parent: 'Education' },
  { id: 'cat_edu_courses', name: 'Courses', parent: 'Education' },

  // --- Income subcategories ---
  { id: 'cat_income_salary',    name: 'Salary',            parent: 'Income' },
  { id: 'cat_income_freelance', name: 'Freelance',         parent: 'Income' },
  { id: 'cat_income_invest',    name: 'Investment Income', parent: 'Income' },
  { id: 'cat_income_gifts',     name: 'Gifts',             parent: 'Income' },

  // --- Savings & Investments subcategories ---
  { id: 'cat_savings_transfer',  name: 'Savings Transfer',   parent: 'Savings & Investments' },
  { id: 'cat_savings_brokerage', name: 'Brokerage Deposit',  parent: 'Savings & Investments' },

  // --- Transfers subcategories ---
  { id: 'cat_transfers_own', name: 'Between Own Accounts', parent: 'Transfers' },
];

/** Top-level category names for validation */
export const TOP_LEVEL_CATEGORY_NAMES: string[] = BUILTIN_CATEGORIES.filter(
  (c) => !c.parent
).map((c) => c.name);

/** Set of all built-in category IDs — used to prevent deletion */
export const BUILTIN_CATEGORY_IDS = new Set<string>(BUILTIN_CATEGORIES.map((c) => c.id));
