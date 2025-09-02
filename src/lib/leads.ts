import { supabase } from './supabase';
import type { Lead, Customer, UserProfile, LeadStatus } from '../types/database';

export interface LeadWithRelations extends Lead {
  customer?: Customer;
  assigned_to?: UserProfile;
  notes?: LeadNote[];
  activities?: LeadActivity[];
  lead_score?: number;
  last_activity_at?: string;
}

export interface LeadNote {
  id: string;
  lead_id: string;
  user_id: string;
  content: string;
  created_at?: string | null;
  user?: UserProfile;
}

export interface LeadActivity {
  id: string;
  lead_id: string;
  user_id?: string | null;
  activity_type: string;
  description: string;
  created_at?: string | null;
  user?: UserProfile;
}

export interface SalesTask {
  id: string;
  organisation_id: string;
  user_id: string;
  title: string;
  description?: string | null;
  due_date?: string | null;
  is_completed: boolean;
  created_at?: string | null;
  completed_at?: string | null;
  user?: UserProfile;
}

export interface RSSFeed {
  id: string;
  organisation_id: string;
  name: string;
  url: string;
  is_active: boolean;
  last_fetched_at?: string | null;
  created_at?: string | null;
}

export interface RSSArticle {
  title: string;
  description: string;
  link: string;
  pubDate: string;
  source: string;
}

export interface LeadFilters {
  status?: string;
  assignedTo?: string;
  source?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  minScore?: number;
  maxScore?: number;
}

export interface AILeadSuggestion {
  type: 'email' | 'call' | 'meeting' | 'quote' | 'follow_up' | 'disqualify';
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  reasoning: string;
}

// Lead operations
export const getLeads = async (
  organisationId: string,
  filters: LeadFilters = {}
): Promise<{ data: LeadWithRelations[] | null; error: Error | null }> => {
  try {
    let query = supabase
      .from('leads')
      .select(`
        *,
        customer:customers(id, name, email, phone_number, city),
        assigned_to:user_profiles(id, full_name, email, role)
      `)
      .eq('organisation_id', organisationId);

    // Apply filters
    if (filters.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    }

    if (filters.assignedTo && filters.assignedTo !== 'all') {
      if (filters.assignedTo === 'unassigned') {
        query = query.is('assigned_to_user_id', null);
      } else {
        query = query.eq('assigned_to_user_id', filters.assignedTo);
      }
    }

    if (filters.source && filters.source !== 'all') {
      query = query.eq('source', filters.source);
    }

    if (filters.dateFrom) {
      query = query.gte('created_at', filters.dateFrom);
    }

    if (filters.dateTo) {
      query = query.lte('created_at', filters.dateTo);
    }

    if (filters.search) {
      query = query.or(`title.ilike.%${filters.search}%,description.ilike.%${filters.search}%`);
    }

    if (filters.minScore !== undefined) {
      query = query.gte('lead_score', filters.minScore);
    }

    if (filters.maxScore !== undefined) {
      query = query.lte('lead_score', filters.maxScore);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data: data || [], error: null };
  } catch (err) {
    console.error('Error fetching leads:', err);
    return { data: null, error: err as Error };
  }
};

export const createLead = async (
  lead: Omit<Lead, 'id' | 'created_at' | 'lead_score' | 'last_activity_at'>
): Promise<{ data: LeadWithRelations | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase
      .from('leads')
      .insert([{
        ...lead,
        last_activity_at: new Date().toISOString()
      }])
      .select(`
        *,
        customer:customers(id, name, email, phone_number, city),
        assigned_to:user_profiles(id, full_name, email, role)
      `)
      .single();

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    // Trigger AI scoring
    if (data) {
      await triggerLeadScoring(data.id);
    }

    return { data, error: null };
  } catch (err) {
    console.error('Error creating lead:', err);
    return { data: null, error: err as Error };
  }
};

export const updateLead = async (
  id: string,
  updates: Partial<Lead>
): Promise<{ data: LeadWithRelations | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase
      .from('leads')
      .update({
        ...updates,
        last_activity_at: new Date().toISOString()
      })
      .eq('id', id)
      .select(`
        *,
        customer:customers(id, name, email, phone_number, city),
        assigned_to:user_profiles(id, full_name, email, role)
      `)
      .single();

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data, error: null };
  } catch (err) {
    console.error('Error updating lead:', err);
    return { data: null, error: err as Error };
  }
};

export const deleteLead = async (id: string): Promise<{ error: Error | null }> => {
    try {
        const { error } = await supabase
            .from('leads')
            .delete()
            .eq('id', id);

        if (error) {
            return { error: new Error(error.message) };
        }

        return { error: null };
    } catch (err) {
        console.error('Error deleting lead:', err);
        return { error: err as Error };
    }
};

// Sales Tasks operations
export const getSalesTasks = async (
  userId: string,
  includeCompleted = false
): Promise<{ data: SalesTask[] | null; error: Error | null }> => {
  try {
    let query = supabase
      .from('sales_tasks')
      .select(`
        *,
        user:user_profiles(id, full_name)
      `)
      .eq('user_id', userId);

    if (!includeCompleted) {
      query = query.eq('is_completed', false);
    }

    const { data, error } = await query.order('due_date', { ascending: true, nullsLast: true });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data: data || [], error: null };
  } catch (err) {
    console.error('Error fetching sales tasks:', err);
    return { data: null, error: err as Error };
  }
};

export const createSalesTask = async (
  task: Omit<SalesTask, 'id' | 'created_at' | 'completed_at'>
): Promise<{ data: SalesTask | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase
      .from('sales_tasks')
      .insert([task])
      .select(`
        *,
        user:user_profiles(id, full_name)
      `)
      .single();

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data, error: null };
  } catch (err) {
    console.error('Error creating sales task:', err);
    return { data: null, error: err as Error };
  }
};

export const updateSalesTask = async (
  id: string,
  updates: Partial<SalesTask>
): Promise<{ data: SalesTask | null; error: Error | null }> => {
  try {
    const updateData = { ...updates };
    
    // Set completed_at when marking as completed
    if (updates.is_completed === true) {
      updateData.completed_at = new Date().toISOString();
    } else if (updates.is_completed === false) {
      updateData.completed_at = null;
    }

    const { data, error } = await supabase
      .from('sales_tasks')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        user:user_profiles(id, full_name)
      `)
      .single();

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data, error: null };
  } catch (err) {
    console.error('Error updating sales task:', err);
    return { data: null, error: err as Error };
  }
};

export const deleteSalesTask = async (id: string): Promise<{ error: Error | null }> => {
  try {
    const { error } = await supabase
      .from('sales_tasks')
      .delete()
      .eq('id', id);

    if (error) {
      return { error: new Error(error.message) };
    }

    return { error: null };
  } catch (err) {
    console.error('Error deleting sales task:', err);
    return { error: err as Error };
  }
};

// RSS Feed operations
export const getRSSFeeds = async (
  organisationId: string
): Promise<{ data: RSSFeed[] | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase
      .from('rss_feeds')
      .select('*')
      .eq('organisation_id', organisationId)
      .order('name');

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data: data || [], error: null };
  } catch (err) {
    console.error('Error fetching RSS feeds:', err);
    return { data: null, error: err as Error };
  }
};

export const createRSSFeed = async (
  feed: Omit<RSSFeed, 'id' | 'created_at' | 'last_fetched_at'>
): Promise<{ data: RSSFeed | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase
      .from('rss_feeds')
      .insert([feed])
      .select()
      .single();

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data, error: null };
  } catch (err) {
    console.error('Error creating RSS feed:', err);
    return { data: null, error: err as Error };
  }
};

export const updateRSSFeed = async (
  id: string,
  updates: Partial<RSSFeed>
): Promise<{ data: RSSFeed | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase
      .from('rss_feeds')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data, error: null };
  } catch (err) {
    console.error('Error updating RSS feed:', err);
    return { data: null, error: err as Error };
  }
};

export const deleteRSSFeed = async (id: string): Promise<{ error: Error | null }> => {
  try {
    const { error } = await supabase
      .from('rss_feeds')
      .delete()
      .eq('id', id);

    if (error) {
      return { error: new Error(error.message) };
    }

    return { error: null };
  } catch (err) {
    console.error('Error deleting RSS feed:', err);
    return { error: err as Error };
  }
};

// AI-powered functions
export const triggerLeadScoring = async (leadId: string): Promise<void> => {
  try {
    await supabase.functions.invoke('score-lead', {
      body: { lead_id: leadId }
    });
  } catch (err) {
    console.error('Error triggering lead scoring:', err);
  }
};

export const getAILeadSuggestions = async (
  leadId: string
): Promise<{ data: AILeadSuggestion[] | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase.functions.invoke('get-lead-suggestions', {
      body: { lead_id: leadId }
    });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data: data.suggestions || [], error: null };
  } catch (err) {
    console.error('Error getting AI lead suggestions:', err);
    return { data: null, error: err as Error };
  }
};

export const fetchRSSArticles = async (
  organisationId: string
): Promise<{ data: RSSArticle[] | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase.functions.invoke('fetch-rss-feeds', {
      body: { organisation_id: organisationId }
    });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data: data.articles || [], error: null };
  } catch (err) {
    console.error('Error fetching RSS articles:', err);
    return { data: null, error: err as Error };
  }
};

// Analytics functions
export const getLeadAnalytics = async (
  organisationId: string,
  userId?: string,
  dateFrom?: string,
  dateTo?: string
): Promise<{
  data: {
    conversionRate: number;
    averageDealSize: number;
    averageSalesCycle: number;
    sourcePerformance: Array<{ source: string; count: number; conversion: number }>;
    totalLeads: number;
    wonLeads: number;
  } | null;
  error: Error | null;
}> => {
  try {
    let query = supabase
      .from('leads')
      .select('*')
      .eq('organisation_id', organisationId);

    if (userId) {
      query = query.eq('assigned_to_user_id', userId);
    }

    if (dateFrom) {
      query = query.gte('created_at', dateFrom);
    }

    if (dateTo) {
      query = query.lte('created_at', dateTo);
    }

    const { data, error } = await query;

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    const leads = data || [];
    const totalLeads = leads.length;
    const wonLeads = leads.filter(lead => lead.status === 'won').length;
    const conversionRate = totalLeads > 0 ? (wonLeads / totalLeads) * 100 : 0;
    
    const averageDealSize = wonLeads > 0 
      ? leads.filter(lead => lead.status === 'won')
             .reduce((sum, lead) => sum + (lead.estimated_value || 0), 0) / wonLeads
      : 0;

    // Calculate average sales cycle (simplified)
    const completedLeads = leads.filter(lead => ['won', 'lost'].includes(lead.status));
    const averageSalesCycle = completedLeads.length > 0
      ? completedLeads.reduce((sum, lead) => {
          const created = new Date(lead.created_at || '');
          const lastActivity = new Date(lead.last_activity_at || lead.created_at || '');
          return sum + Math.floor((lastActivity.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
        }, 0) / completedLeads.length
      : 0;

    // Source performance
    const sourceStats = leads.reduce((acc, lead) => {
      const source = lead.source || 'Okänd';
      if (!acc[source]) {
        acc[source] = { total: 0, won: 0 };
      }
      acc[source].total++;
      if (lead.status === 'won') {
        acc[source].won++;
      }
      return acc;
    }, {} as Record<string, { total: number; won: number }>);

    const sourcePerformance = Object.entries(sourceStats).map(([source, stats]) => ({
      source,
      count: stats.total,
      conversion: stats.total > 0 ? (stats.won / stats.total) * 100 : 0
    }));

    return {
      data: {
        conversionRate: Math.round(conversionRate * 10) / 10,
        averageDealSize,
        averageSalesCycle: Math.round(averageSalesCycle),
        sourcePerformance,
        totalLeads,
        wonLeads
      },
      error: null
    };
  } catch (err) {
    console.error('Error fetching lead analytics:', err);
    return { data: null, error: err as Error };
  }
};

// Utility functions
export const getLeadScoreColor = (score: number): string => {
  if (score >= 80) return 'bg-green-100 text-green-800 border-green-200';
  if (score >= 60) return 'bg-yellow-100 text-yellow-800 border-yellow-200';
  if (score >= 40) return 'bg-orange-100 text-orange-800 border-orange-200';
  return 'bg-red-100 text-red-800 border-red-200';
};

export const getLeadScoreLabel = (score: number): string => {
  if (score >= 80) return 'Hög kvalitet';
  if (score >= 60) return 'Medel kvalitet';
  if (score >= 40) return 'Låg kvalitet';
  return 'Mycket låg kvalitet';
};

export const getNextActionSuggestion = (lead: LeadWithRelations): string => {
  const daysSinceLastActivity = lead.last_activity_at 
    ? Math.floor((Date.now() - new Date(lead.last_activity_at).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  switch (lead.status) {
    case 'new':
      return 'Kontakta inom 24 timmar';
    case 'contacted':
      if (daysSinceLastActivity > 3) return 'Följ upp kontakt';
      return 'Vänta på svar';
    case 'qualified':
      return 'Skicka offert';
    default:
      if (daysSinceLastActivity > 7) return 'Följ upp aktivitet';
      return 'Fortsätt dialog';
  }
};

export const createLeadFromArticle = async (
  article: RSSArticle,
  organisationId: string,
  assignedToUserId?: string
): Promise<{ data: LeadWithRelations | null; error: Error | null }> => {
  try {
    const leadData = {
      organisation_id: organisationId,
      title: article.title,
      description: `${article.description}\n\nKälla: ${article.link}`,
      source: 'News Feed',
      status: 'new' as LeadStatus,
      assigned_to_user_id: assignedToUserId,
      estimated_value: null,
      customer_id: null
    };

    return await createLead(leadData);
  } catch (err) {
    console.error('Error creating lead from article:', err);
    return { data: null, error: err as Error };
  }
};


 
export const getLead = async (
  id: string
): Promise<{ data: LeadWithRelations | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase
  .from('leads')
      .select(`
        *,
        customer:customers(*),
        assigned_to:user_profiles(*),
        notes:lead_notes(*, user:user_profiles(full_name)),
        activities:lead_activities(*, user:user_profiles(full_name))
      `)
      .eq('id', id)
      .single();

    if (error) {
      return { data: null, error: new Error(error.message) };
    }
    return { data, error: null };
  } catch (err) {
    console.error(`Error fetching lead ${id}:`, err);
    return { data: null, error: err as Error };
  }
};
