//! The household graph: objects, the links between them, and the relations
//! those links stand for.
//!
//! The module is independent: a library that never uses it has no tables at
//! all, and every read path asks `tables_present` before it touches the
//! library. The tables are created when the first graph is written, not by a
//! migration, so a library without a graph does not carry six empty tables.

use rusqlite::{Connection, OptionalExtension, params};
use std::collections::{HashMap, HashSet};

/// The classes an object can have. The first version opens `person` only.
pub struct NodeClass {
    pub name: &'static str,
}

/// Everything one kind of link is.
pub struct RelationType {
    /// 'parent' | 'spouse' | 'social'
    pub kind: &'static str,
    /// The social labels use it.
    pub label: Option<&'static str>,
    /// The class of the object the link starts at.
    pub from: &'static str,
    /// The class of the object the link ends at.
    pub to: &'static str,
    pub direction: Direction,
    /// How the other end reads it ('student' for a teacher).
    pub inverse_label: Option<&'static str>,
    /// Whether the link takes part in the kinship derivation.
    pub generative: bool,
    /// Whether the interface offers a period of validity for it.
    pub time_scoped: bool,
}

/// Whether a link is stored once or twice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    /// Stored once, from the parent to the child and from the teacher to the student.
    Directed,
    /// Stored once, with the smaller object id first.
    Symmetric,
}

/// Every object class there is.
pub static NODE_CLASSES: &[NodeClass] = &[NodeClass { name: "person" }];

/// Every kind of link there is.
pub static RELATION_TYPES: &[RelationType] = &[
    RelationType {
        kind: "parent",
        label: None,
        from: "person",
        to: "person",
        direction: Direction::Directed,
        inverse_label: None,
        generative: true,
        time_scoped: false,
    },
    RelationType {
        kind: "spouse",
        label: None,
        from: "person",
        to: "person",
        direction: Direction::Symmetric,
        inverse_label: None,
        generative: true,
        time_scoped: true,
    },
    RelationType {
        kind: "social",
        label: Some("classmate"),
        from: "person",
        to: "person",
        direction: Direction::Symmetric,
        inverse_label: None,
        generative: false,
        time_scoped: true,
    },
    RelationType {
        kind: "social",
        label: Some("teacher"),
        from: "person",
        to: "person",
        direction: Direction::Directed,
        inverse_label: Some("student"),
        generative: false,
        time_scoped: true,
    },
    RelationType {
        kind: "social",
        label: Some("friend"),
        from: "person",
        to: "person",
        direction: Direction::Symmetric,
        inverse_label: None,
        generative: false,
        time_scoped: true,
    },
    RelationType {
        kind: "social",
        label: Some("colleague"),
        from: "person",
        to: "person",
        direction: Direction::Symmetric,
        inverse_label: None,
        generative: false,
        time_scoped: true,
    },
    RelationType {
        kind: "social",
        label: Some("neighbour"),
        from: "person",
        to: "person",
        direction: Direction::Symmetric,
        inverse_label: None,
        generative: false,
        time_scoped: true,
    },
    RelationType {
        kind: "social",
        label: Some("partner"),
        from: "person",
        to: "person",
        direction: Direction::Symmetric,
        inverse_label: None,
        generative: false,
        time_scoped: true,
    },
];

/// The tables of the module.
pub const TABLES: [&str; 6] = [
    "household_nodes",
    "household_node_anchors",
    "households",
    "household_members",
    "household_edges",
    "household_albums",
];

/// Whether this library has the tables of the module.
///
/// This is the one question every read path asks: without the tables there
/// is no graph, and nothing about the library may change.
pub fn tables_present(conn: &Connection) -> Result<bool, String> {
    let mut stmt = conn
        .prepare("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)")
        .map_err(|e| e.to_string())?;
    let present: bool = stmt
        .query_row(["household_nodes"], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    Ok(present)
}

/// Create the tables of the module.
///
/// Calling it twice is not a problem: every statement is `IF NOT EXISTS`.
pub fn ensure_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "-- Objects (nodes). They belong to the library, not to a graph.
         CREATE TABLE IF NOT EXISTS household_nodes (
             id            INTEGER PRIMARY KEY AUTOINCREMENT,
             kind          TEXT NOT NULL DEFAULT 'person',
             display_name  TEXT,
             gender        TEXT NOT NULL DEFAULT 'unknown',
             birth_date    TEXT,
             birth_place   TEXT,
             notes         TEXT,
             share_age     INTEGER NOT NULL DEFAULT 1,
             share_details INTEGER NOT NULL DEFAULT 0,
             created_at    INTEGER NOT NULL,
             updated_at    INTEGER NOT NULL
         );

         -- Anchors: the way an object is tied to a name of a face.
         CREATE TABLE IF NOT EXISTS household_node_anchors (
             id         INTEGER PRIMARY KEY AUTOINCREMENT,
             node_id    INTEGER NOT NULL REFERENCES household_nodes(id) ON DELETE CASCADE,
             kind       TEXT NOT NULL,
             value      TEXT NOT NULL,
             created_at INTEGER NOT NULL,
             UNIQUE (kind, value)
         );

         -- Graphs: a root, its members and the albums it applies to.
         CREATE TABLE IF NOT EXISTS households (
             id           INTEGER PRIMARY KEY AUTOINCREMENT,
             name         TEXT NOT NULL,
             enabled      INTEGER NOT NULL DEFAULT 1,
             root_node_id INTEGER REFERENCES household_nodes(id) ON DELETE SET NULL,
             created_at   INTEGER NOT NULL,
             updated_at   INTEGER NOT NULL
         );

         -- Which objects belong to which graph.
         CREATE TABLE IF NOT EXISTS household_members (
             household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
             node_id      INTEGER NOT NULL REFERENCES household_nodes(id) ON DELETE CASCADE,
             PRIMARY KEY (household_id, node_id)
         );

         -- Links (edges). A fact between two objects.
         CREATE TABLE IF NOT EXISTS household_edges (
             id            INTEGER PRIMARY KEY AUTOINCREMENT,
             kind          TEXT NOT NULL,
             from_node     INTEGER NOT NULL REFERENCES household_nodes(id) ON DELETE CASCADE,
             to_node       INTEGER NOT NULL REFERENCES household_nodes(id) ON DELETE CASCADE,
             label         TEXT,
             term_override TEXT,
             valid_from    INTEGER,
             valid_to      INTEGER,
             source        TEXT NOT NULL DEFAULT 'user',
             created_at    INTEGER NOT NULL
         );

         -- A label may be empty, and SQLite treats NULLs in a UNIQUE index as
         -- different from each other; the expression index keeps one link per
         -- pair of objects and kind.
         CREATE UNIQUE INDEX IF NOT EXISTS idx_household_edges_unique
             ON household_edges (kind, from_node, to_node, COALESCE(label, ''));

         -- The albums a graph applies to.
         CREATE TABLE IF NOT EXISTS household_albums (
             household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
             album_id     INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
             PRIMARY KEY (household_id, album_id)
         );",
    )
    .map_err(|e| format!("Failed to create the household tables: {e}"))
}

/// The kind of link the catalog knows, for a kind and a label.
///
/// `parent` and `spouse` carry no label; the social links need one.
pub fn relation_type(kind: &str, label: Option<&str>) -> Option<&'static RelationType> {
    RELATION_TYPES
        .iter()
        .find(|relation| relation.kind == kind && relation.label == label)
}

/// Whether the catalog knows this kind of link.
pub fn is_known_kind(kind: &str) -> bool {
    RELATION_TYPES.iter().any(|relation| relation.kind == kind)
}

/// Whether the catalog knows this social label.
pub fn is_known_label(label: &str) -> bool {
    RELATION_TYPES
        .iter()
        .any(|relation| relation.label == Some(label))
}

/// Whether the catalog knows this object class.
pub fn is_known_class(name: &str) -> bool {
    NODE_CLASSES.iter().any(|class| class.name == name)
}

/// Whether a link may connect two objects of these classes.
pub fn relation_accepts_classes(relation: &RelationType, from_class: &str, to_class: &str) -> bool {
    relation.from == from_class && relation.to == to_class
}

/// The two ends of a link, in the order they are stored.
///
/// A symmetric link is stored once, with the smaller object id first. A
/// directed link keeps the order it was given: a teacher is stored as
/// teacher → student, never the other way round.
pub fn normalise_ends(relation: &RelationType, from_node: i64, to_node: i64) -> (i64, i64) {
    match relation.direction {
        Direction::Symmetric => {
            if from_node <= to_node {
                (from_node, to_node)
            } else {
                (to_node, from_node)
            }
        }
        Direction::Directed => (from_node, to_node),
    }
}

/// One object of the graph.
#[derive(Debug, Clone)]
pub struct HouseholdNode {
    /// None for a new object.
    pub id: Option<i64>,
    pub kind: String,
    /// The name the user calls this person by.
    pub display_name: Option<String>,
    pub gender: String,
    pub birth_date: Option<String>,
    pub birth_place: Option<String>,
    pub notes: Option<String>,
    /// Whether the age of this person may go to the model.
    pub share_age: bool,
    /// Whether the birth place and the notes of this person may go to the model.
    pub share_details: bool,
    /// The names of faces that belong to this object.
    pub anchors: Vec<String>,
}

impl Default for HouseholdNode {
    fn default() -> Self {
        HouseholdNode {
            id: None,
            kind: "person".to_string(),
            display_name: None,
            gender: "unknown".to_string(),
            birth_date: None,
            birth_place: None,
            notes: None,
            share_age: true,
            share_details: false,
            anchors: Vec::new(),
        }
    }
}

/// One link between two objects.
#[derive(Debug, Clone)]
pub struct HouseholdEdge {
    pub kind: String,
    pub from_node: i64,
    pub to_node: i64,
    /// The social links carry one.
    pub label: Option<String>,
    /// The word to use when the derivation cannot find the right one.
    pub term_override: Option<String>,
    /// The year the link starts, if it has one.
    pub valid_from: Option<i64>,
    /// The year the link ends, if it has one.
    pub valid_to: Option<i64>,
    /// 'user' | 'imported' | 'suggested'
    pub source: String,
}

impl Default for HouseholdEdge {
    fn default() -> Self {
        HouseholdEdge {
            kind: String::new(),
            from_node: 0,
            to_node: 0,
            label: None,
            term_override: None,
            valid_from: None,
            valid_to: None,
            source: "user".to_string(),
        }
    }
}

/// The kinds of source a link may have.
pub const SOURCES: [&str; 3] = ["user", "imported", "suggested"];

/// The gender of an object.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Gender {
    Male,
    Female,
    Unknown,
}

impl Gender {
    /// The gender as the library stores it.
    pub fn parse(value: &str) -> Gender {
        match value {
            "male" => Gender::Male,
            "female" => Gender::Female,
            _ => Gender::Unknown,
        }
    }
}

/// What the derivation needs to know about an object.
#[derive(Debug, Clone)]
pub struct DerivationNode {
    pub id: i64,
    /// 'male' | 'female' | 'unknown'
    pub gender: String,
    /// The year the person was born, if the user wrote it down.
    pub birth_year: Option<i32>,
}

/// One link as the derivation sees it.
#[derive(Debug, Clone)]
pub struct DerivationEdge {
    pub kind: String,
    pub from_node: i64,
    pub to_node: i64,
    pub label: Option<String>,
    /// The word to use instead of the derived one.
    pub term_override: Option<String>,
    pub valid_from: Option<i64>,
    pub valid_to: Option<i64>,
    pub source: String,
}

/// What the derivation found out about two people.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Relation {
    /// The word, as it follows "是……的".
    pub term: String,
    /// The person the word is relative to, when the word alone is not enough.
    pub via: Option<i64>,
}

/// The age of a person in the year of a photo.
pub fn age_at(birth_year: Option<i32>, taken_year: i64) -> Option<i64> {
    birth_year.map(|year| taken_year - i64::from(year))
}

/// The year of a birth date like '2011', '2011-05' or '2011-05-07'.
pub fn birth_year_of(birth_date: Option<&str>) -> Option<i32> {
    let date = birth_date?.trim();
    let year: String = date.chars().take_while(|c| c.is_ascii_digit()).collect();
    if year.len() != 4 {
        return None;
    }
    year.parse::<i32>().ok()
}

/// The derivation of the relations between the objects of a graph.
pub struct Derivation<'a> {
    nodes: &'a [DerivationNode],
    edges: &'a [DerivationEdge],
    /// The year of the photo. Without it every link counts.
    year: Option<i64>,
}

impl<'a> Derivation<'a> {
    pub fn new(
        nodes: &'a [DerivationNode],
        edges: &'a [DerivationEdge],
        year: Option<i64>,
    ) -> Derivation<'a> {
        Derivation { nodes, edges, year }
    }

    /// What A is to B, as the word that follows "是……的".
    ///
    /// The relations are looked for from the shortest way round: the spouse
    /// and the parent come before the grandparent, and the grandparent before
    /// the cousin. Social links never take part; they are only used when
    /// there is no relation to find at all.
    pub fn term(&self, a: i64, b: i64) -> Option<Relation> {
        if a == b {
            return None;
        }
        // One step: the spouse, the parent, the child.
        if let Some(edge) = self.spouse_between(a, b) {
            return Some(Relation {
                term: self
                    .term_override(edge)
                    .unwrap_or_else(|| match self.gender(a) {
                        Gender::Male => "丈夫".to_string(),
                        Gender::Female => "妻子".to_string(),
                        Gender::Unknown => "配偶".to_string(),
                    }),
                via: None,
            });
        }
        if let Some(edge) = self.ex_spouse_between(a, b) {
            return Some(Relation {
                term: self
                    .term_override(edge)
                    .unwrap_or_else(|| match self.gender(a) {
                        Gender::Male => "前夫".to_string(),
                        Gender::Female => "前妻".to_string(),
                        Gender::Unknown => "前伴侣".to_string(),
                    }),
                via: None,
            });
        }
        if let Some(edge) = self.parent_edge(a, b) {
            return Some(Relation {
                term: self
                    .term_override(edge)
                    .unwrap_or_else(|| match self.gender(a) {
                        Gender::Male => "父亲".to_string(),
                        Gender::Female => "母亲".to_string(),
                        Gender::Unknown => "父母".to_string(),
                    }),
                via: None,
            });
        }
        if let Some(edge) = self.parent_edge(b, a) {
            return Some(Relation {
                term: self
                    .term_override(edge)
                    .unwrap_or_else(|| match self.gender(a) {
                        Gender::Male => "儿子".to_string(),
                        Gender::Female => "女儿".to_string(),
                        Gender::Unknown => "孩子".to_string(),
                    }),
                via: None,
            });
        }

        // Two steps: the sibling, the grandparent, the grandchild, the parents
        // of the spouse, the spouse of the child.
        if let Some(relation) = self.sibling_relation(a, b) {
            return Some(relation);
        }
        if let Some(relation) = self.grandparent_relation(a, b) {
            return Some(relation);
        }
        if let Some(relation) = self.grandchild_relation(a, b) {
            return Some(relation);
        }
        if let Some(relation) = self.parent_in_law_relation(a, b) {
            return Some(relation);
        }
        if let Some(relation) = self.child_in_law_relation(a, b) {
            return Some(relation);
        }

        // Three steps: the uncle and the aunt, the spouse of the sibling, the
        // spouse of the grandchild.
        if let Some(relation) = self.uncle_aunt_relation(a, b) {
            return Some(relation);
        }
        if let Some(relation) = self.sibling_in_law_relation(a, b) {
            return Some(relation);
        }
        if let Some(relation) = self.grandchild_in_law_relation(a, b) {
            return Some(relation);
        }

        // Four steps: the cousin.
        if let Some(relation) = self.cousin_relation(a, b) {
            return Some(relation);
        }

        self.social_relation(a, b)
    }

    // ---- the helpers ----

    /// The object, if the library knows it.
    fn node(&self, id: i64) -> Option<&'a DerivationNode> {
        self.nodes.iter().find(|node| node.id == id)
    }

    fn gender(&self, id: i64) -> Gender {
        match self.node(id) {
            Some(node) => Gender::parse(&node.gender),
            None => Gender::Unknown,
        }
    }

    fn birth_year(&self, id: i64) -> Option<i32> {
        self.node(id).and_then(|node| node.birth_year)
    }

    /// Whether the link is a fact of the library at the time of the photo.
    ///
    /// A link that is only suggested is a guess, not a fact. Without a time to
    /// judge it by, every link counts.
    fn holds(&self, edge: &DerivationEdge) -> bool {
        if edge.source == "suggested" {
            return false;
        }
        match self.year {
            None => true,
            Some(year) => {
                edge.valid_from.map_or(true, |from| from <= year)
                    && edge.valid_to.map_or(true, |to| year < to)
            }
        }
    }

    /// Whether the link has ended before the photo.
    fn ended(&self, edge: &DerivationEdge) -> bool {
        match (self.year, edge.valid_to) {
            (Some(year), Some(to)) => year >= to,
            _ => false,
        }
    }

    /// The word the user gave this link, if they gave one.
    fn term_override(&self, edge: &DerivationEdge) -> Option<String> {
        edge.term_override
            .clone()
            .filter(|word| !word.trim().is_empty())
    }

    /// The parent link from a parent to a child.
    fn parent_edge(&self, parent: i64, child: i64) -> Option<&'a DerivationEdge> {
        self.edges.iter().find(|edge| {
            edge.kind == "parent"
                && edge.from_node == parent
                && edge.to_node == child
                && self.holds(edge)
        })
    }

    /// The parents of an object, with the link that says so.
    fn parents(&self, id: i64) -> Vec<(i64, &'a DerivationEdge)> {
        self.edges
            .iter()
            .filter(|edge| edge.kind == "parent" && edge.to_node == id && self.holds(edge))
            .map(|edge| (edge.from_node, edge))
            .collect()
    }

    /// The children of an object, with the link that says so.
    fn children(&self, id: i64) -> Vec<(i64, &'a DerivationEdge)> {
        self.edges
            .iter()
            .filter(|edge| edge.kind == "parent" && edge.from_node == id && self.holds(edge))
            .map(|edge| (edge.to_node, edge))
            .collect()
    }

    /// The spouse of an object, with the link that says so.
    fn spouse_of(&self, id: i64) -> Option<(i64, &'a DerivationEdge)> {
        self.edges
            .iter()
            .filter(|edge| edge.kind == "spouse" && self.holds(edge))
            .find(|edge| edge.from_node == id || edge.to_node == id)
            .map(|edge| {
                let other = if edge.from_node == id {
                    edge.to_node
                } else {
                    edge.from_node
                };
                (other, edge)
            })
    }

    /// The marriage of two people, while it lasts.
    fn spouse_between(&self, a: i64, b: i64) -> Option<&'a DerivationEdge> {
        self.edges.iter().find(|edge| {
            edge.kind == "spouse"
                && self.holds(edge)
                && ((edge.from_node == a && edge.to_node == b)
                    || (edge.from_node == b && edge.to_node == a))
        })
    }

    /// The marriage of two people, after it ended.
    fn ex_spouse_between(&self, a: i64, b: i64) -> Option<&'a DerivationEdge> {
        self.edges.iter().find(|edge| {
            edge.kind == "spouse"
                && !self.holds(edge)
                && self.ended(edge)
                && ((edge.from_node == a && edge.to_node == b)
                    || (edge.from_node == b && edge.to_node == a))
        })
    }

    /// Whether the two of them share a parent, and the link from A's side.
    fn are_siblings(&self, a: i64, b: i64) -> Option<&'a DerivationEdge> {
        let parents_of_b: Vec<i64> = self.parents(b).into_iter().map(|(id, _)| id).collect();
        self.parents(a)
            .into_iter()
            .find(|(parent, _)| parents_of_b.contains(parent))
            .map(|(_, edge)| edge)
    }

    /// Who is older, when both wrote down when they were born.
    fn is_older(&self, a: i64, b: i64) -> Option<bool> {
        match (self.birth_year(a), self.birth_year(b)) {
            (Some(year_a), Some(year_b)) if year_a != year_b => Some(year_a < year_b),
            _ => None,
        }
    }

    // ---- the relations ----

    /// A is the sibling of B.
    fn sibling_relation(&self, a: i64, b: i64) -> Option<Relation> {
        let edge = self.are_siblings(a, b)?;
        let word = match (self.is_older(a, b), self.gender(a)) {
            (Some(true), Gender::Male) => "哥哥",
            (Some(true), Gender::Female) => "姐姐",
            (Some(false), Gender::Male) => "弟弟",
            (Some(false), Gender::Female) => "妹妹",
            (_, Gender::Male) => "兄弟",
            (_, Gender::Female) => "姐妹",
            (_, Gender::Unknown) => "兄弟姐妹",
        };
        Some(Relation {
            term: self.term_override(edge).unwrap_or_else(|| word.to_string()),
            via: None,
        })
    }

    /// A is the grandparent of B.
    fn grandparent_relation(&self, a: i64, b: i64) -> Option<Relation> {
        for (parent, _) in self.parents(b) {
            for (grandparent, edge) in self.parents(parent) {
                if grandparent != a {
                    continue;
                }
                let word = match self.gender(parent) {
                    Gender::Male => match self.gender(a) {
                        Gender::Male => "爷爷",
                        Gender::Female => "奶奶",
                        Gender::Unknown => "祖父母",
                    },
                    Gender::Female => match self.gender(a) {
                        Gender::Male => "外公",
                        Gender::Female => "外婆",
                        Gender::Unknown => "外祖父母",
                    },
                    Gender::Unknown => "祖父母",
                };
                return Some(Relation {
                    term: self.term_override(edge).unwrap_or_else(|| word.to_string()),
                    via: None,
                });
            }
        }
        None
    }

    /// A is the grandchild of B.
    fn grandchild_relation(&self, a: i64, b: i64) -> Option<Relation> {
        for (child, _) in self.children(b) {
            for (grandchild, edge) in self.children(child) {
                if grandchild != a {
                    continue;
                }
                let word = match self.gender(child) {
                    Gender::Male => match self.gender(a) {
                        Gender::Male => "孙子",
                        Gender::Female => "孙女",
                        Gender::Unknown => "孙子女",
                    },
                    Gender::Female => match self.gender(a) {
                        Gender::Male => "外孙",
                        Gender::Female => "外孙女",
                        Gender::Unknown => "外孙子女",
                    },
                    Gender::Unknown => "孙子女",
                };
                return Some(Relation {
                    term: self.term_override(edge).unwrap_or_else(|| word.to_string()),
                    via: None,
                });
            }
        }
        None
    }

    /// A is the father or the mother of the spouse of B.
    fn parent_in_law_relation(&self, a: i64, b: i64) -> Option<Relation> {
        let (spouse, _) = self.spouse_of(b)?;
        for (parent, edge) in self.parents(spouse) {
            if parent != a {
                continue;
            }
            let word = match (self.gender(b), self.gender(a)) {
                (Gender::Male, Gender::Male) => "岳父",
                (Gender::Male, Gender::Female) => "岳母",
                (Gender::Male, Gender::Unknown) => "岳父或岳母",
                (Gender::Female, Gender::Male) => "公公",
                (Gender::Female, Gender::Female) => "婆婆",
                (Gender::Female, Gender::Unknown) => "公公或婆婆",
                (Gender::Unknown, _) => "姻亲",
            };
            return Some(Relation {
                term: self.term_override(edge).unwrap_or_else(|| word.to_string()),
                via: None,
            });
        }
        None
    }

    /// A is the wife of the son, or the husband of the daughter, of B.
    fn child_in_law_relation(&self, a: i64, b: i64) -> Option<Relation> {
        for (child, _) in self.children(b) {
            let (spouse, edge) = match self.spouse_of(child) {
                Some(pair) => pair,
                None => continue,
            };
            if spouse != a {
                continue;
            }
            let word = match (self.gender(child), self.gender(a)) {
                (Gender::Male, Gender::Female) => Some("儿媳".to_string()),
                (Gender::Female, Gender::Male) => Some("女婿".to_string()),
                _ => None,
            };
            let fallback = word.is_none();
            return Some(Relation {
                term: self
                    .term_override(edge)
                    .unwrap_or_else(|| word.unwrap_or_else(|| "伴侣".to_string())),
                via: fallback.then_some(child),
            });
        }
        None
    }

    /// A is the uncle, the aunt, the nephew or the niece of B.
    fn uncle_aunt_relation(&self, a: i64, b: i64) -> Option<Relation> {
        for (parent, _) in self.parents(b) {
            let edge = match self.are_siblings(a, parent) {
                Some(edge) => edge,
                None => continue,
            };
            let word = match self.gender(parent) {
                Gender::Male => match self.gender(a) {
                    Gender::Male => match self.is_older(a, parent) {
                        Some(true) => "伯伯",
                        Some(false) => "叔叔",
                        None => "伯父或叔父",
                    },
                    Gender::Female => "姑姑",
                    Gender::Unknown => "叔伯或姑",
                },
                Gender::Female => match self.gender(a) {
                    Gender::Male => "舅舅",
                    Gender::Female => "姨母",
                    Gender::Unknown => "舅或姨",
                },
                Gender::Unknown => "叔伯姑舅姨",
            };
            return Some(Relation {
                term: self.term_override(edge).unwrap_or_else(|| word.to_string()),
                via: None,
            });
        }
        None
    }

    /// A is the husband or the wife of the sibling of B.
    fn sibling_in_law_relation(&self, a: i64, b: i64) -> Option<Relation> {
        // The siblings of B: the children of B's parents, apart from B.
        let siblings: Vec<i64> = self
            .parents(b)
            .into_iter()
            .flat_map(|(parent, _)| self.children(parent))
            .map(|(child, _)| child)
            .filter(|child| *child != b)
            .collect();
        for sibling in siblings {
            let (spouse, edge) = match self.spouse_of(sibling) {
                Some(pair) => pair,
                None => continue,
            };
            if spouse != a {
                continue;
            }
            let older = self.is_older(sibling, b);
            let word = match (self.gender(sibling), self.gender(a), older) {
                (Gender::Male, Gender::Female, Some(true)) => Some("嫂子".to_string()),
                (Gender::Male, Gender::Female, Some(false)) => Some("弟媳".to_string()),
                (Gender::Female, Gender::Male, Some(true)) => Some("姐夫".to_string()),
                (Gender::Female, Gender::Male, Some(false)) => Some("妹夫".to_string()),
                _ => None,
            };
            let fallback = word.is_none();
            return Some(Relation {
                term: self
                    .term_override(edge)
                    .unwrap_or_else(|| word.unwrap_or_else(|| "兄弟姐妹的伴侣".to_string())),
                via: fallback.then_some(sibling),
            });
        }
        None
    }

    /// A is the wife of the grandson, or the husband of the granddaughter, of B.
    fn grandchild_in_law_relation(&self, a: i64, b: i64) -> Option<Relation> {
        for (child, _) in self.children(b) {
            for (grandchild, _) in self.children(child) {
                let (spouse, edge) = match self.spouse_of(grandchild) {
                    Some(pair) => pair,
                    None => continue,
                };
                if spouse != a {
                    continue;
                }
                let word = match (self.gender(grandchild), self.gender(a)) {
                    (Gender::Male, Gender::Female) => Some("孙媳".to_string()),
                    (Gender::Female, Gender::Male) => Some("孙女婿".to_string()),
                    _ => None,
                };
                let fallback = word.is_none();
                return Some(Relation {
                    term: self
                        .term_override(edge)
                        .unwrap_or_else(|| word.unwrap_or_else(|| "孙辈的伴侣".to_string())),
                    via: fallback.then_some(grandchild),
                });
            }
        }
        None
    }

    /// A and B are cousins.
    fn cousin_relation(&self, a: i64, b: i64) -> Option<Relation> {
        let grandparents_of_b: Vec<i64> = self
            .parents(b)
            .into_iter()
            .flat_map(|(parent, _)| self.parents(parent))
            .map(|(id, _)| id)
            .collect();
        let shared: Vec<(i64, &'a DerivationEdge)> = self
            .parents(a)
            .into_iter()
            .flat_map(|(parent, _)| self.parents(parent))
            .filter(|(grandparent, _)| grandparents_of_b.contains(grandparent))
            .collect();
        let edge = match shared.first() {
            Some((_, edge)) => *edge,
            None => return None,
        };
        // Two married grandparents mean the cousins share both sides: that is
        // the family of the father, the 堂 side. One grandparent means the
        // other side, the 表 side.
        let paternal = shared.len() >= 2
            && shared.iter().all(|(grandparent, _)| {
                self.spouse_of(*grandparent)
                    .map(|(other, _)| shared.iter().any(|(id, _)| *id == other))
                    .unwrap_or(false)
            });
        Some(Relation {
            term: self.term_override(edge).unwrap_or_else(|| {
                if paternal {
                    "堂兄弟姐妹"
                } else {
                    "表兄弟姐妹"
                }
                .to_string()
            }),
            via: None,
        })
    }

    /// A and B are connected by a social link.
    fn social_relation(&self, a: i64, b: i64) -> Option<Relation> {
        let edge = self.edges.iter().find(|edge| {
            edge.kind == "social"
                && self.holds(edge)
                && ((edge.from_node == a && edge.to_node == b)
                    || (edge.from_node == b && edge.to_node == a))
        })?;
        let label = edge.label.as_deref()?;
        let word = match label {
            "classmate" => "同学",
            "teacher" => {
                if edge.from_node == a {
                    "老师"
                } else {
                    "学生"
                }
            }
            "friend" => "朋友",
            "colleague" => "同事",
            "neighbour" => "邻居",
            "partner" => "恋人",
            _ => return None,
        };
        Some(Relation {
            term: self.term_override(edge).unwrap_or_else(|| word.to_string()),
            via: None,
        })
    }
}

/// The kind of anchor that ties an object to a name of a face.
pub const ANCHOR_FACE_NAME: &str = "face_name";

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// The object the name of a face belongs to.
fn anchor_owner(conn: &Connection, value: &str) -> Result<Option<i64>, String> {
    let owner = conn
        .query_row(
            "SELECT node_id FROM household_node_anchors WHERE kind = ?1 AND value = ?2",
            params![ANCHOR_FACE_NAME, value],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(owner)
}

/// The class of an object.
fn node_class(conn: &Connection, node_id: i64) -> Result<Option<String>, String> {
    let class = conn
        .query_row(
            "SELECT kind FROM household_nodes WHERE id = ?1",
            params![node_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(class)
}

/// The members of a graph.
fn member_ids(conn: &Connection, household_id: i64) -> Result<Vec<i64>, String> {
    let mut stmt = conn
        .prepare("SELECT node_id FROM household_members WHERE household_id = ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![household_id], |row| row.get::<_, i64>(0))
        .map_err(|e| e.to_string())?;
    let mut ids = Vec::new();
    for row in rows {
        ids.push(row.map_err(|e| e.to_string())?);
    }
    Ok(ids)
}

/// Whether a graph exists.
fn household_exists(conn: &Connection, household_id: i64) -> Result<bool, String> {
    let exists = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM households WHERE id = ?1)",
            params![household_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(exists)
}

/// Whether the given parent links contain a cycle.
fn parents_form_a_cycle(parents: &[(i64, i64)]) -> bool {
    let mut above: HashMap<i64, Vec<i64>> = HashMap::new();
    for (parent, child) in parents {
        above.entry(*child).or_default().push(*parent);
    }
    for start in above.keys() {
        let mut seen: HashSet<i64> = HashSet::new();
        let mut stack = vec![*start];
        while let Some(node) = stack.pop() {
            if !seen.insert(node) {
                return true;
            }
            if let Some(list) = above.get(&node) {
                stack.extend(list.iter().copied());
            }
        }
    }
    false
}

/// Create a graph: the members it imports, the root and the albums it applies to.
///
/// The root must be the name of a face, either one of the imported names or a
/// name that is already in the library.
pub fn create_household_with_conn(
    conn: &mut Connection,
    name: &str,
    album_ids: &[i64],
    root_node_name: &str,
    import_names: &[String],
) -> Result<i64, String> {
    if name.trim().is_empty() {
        return Err("A graph needs a name".to_string());
    }
    let root_name = root_node_name.trim();
    if root_name.is_empty() || crate::t_sqlite::Person::is_automatic_name(Some(root_name)) {
        return Err("The root must be a name of a face".to_string());
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    ensure_schema(&tx)?;

    let imported = import_names_with_conn(&tx, import_names)?;
    let root_id = match anchor_owner(&tx, root_name)? {
        Some(node_id) => node_id,
        None => {
            return Err(format!(
                "{root_name} is not the name of anyone in the library"
            ));
        }
    };

    let timestamp = now();
    tx.execute(
        "INSERT INTO households(name, enabled, root_node_id, created_at, updated_at)
         VALUES(?1, 1, ?2, ?3, ?3)",
        params![name.trim(), root_id, timestamp],
    )
    .map_err(|e| format!("Failed to create the graph: {e}"))?;
    let household_id = tx.last_insert_rowid();

    for node_id in imported.iter().copied().chain(std::iter::once(root_id)) {
        tx.execute(
            "INSERT OR IGNORE INTO household_members(household_id, node_id) VALUES(?1, ?2)",
            params![household_id, node_id],
        )
        .map_err(|e| format!("Failed to add a member to the graph: {e}"))?;
    }
    for album_id in album_ids {
        tx.execute(
            "INSERT OR IGNORE INTO household_albums(household_id, album_id) VALUES(?1, ?2)",
            params![household_id, album_id],
        )
        .map_err(|e| format!("Failed to add an album to the graph: {e}"))?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(household_id)
}

/// Change a graph: its name, whether it is used, its albums and its root.
pub fn update_household_with_conn(
    conn: &mut Connection,
    household_id: i64,
    name: Option<&str>,
    enabled: Option<bool>,
    album_ids: Option<&[i64]>,
    root_node_id: Option<i64>,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    if !household_exists(&tx, household_id)? {
        return Err("The graph is gone".to_string());
    }
    let timestamp = now();
    if let Some(name) = name {
        if name.trim().is_empty() {
            return Err("A graph needs a name".to_string());
        }
        tx.execute(
            "UPDATE households SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name.trim(), timestamp, household_id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(enabled) = enabled {
        tx.execute(
            "UPDATE households SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
            params![i64::from(enabled), timestamp, household_id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(root_node_id) = root_node_id {
        if node_class(&tx, root_node_id)?.is_none() {
            return Err("The object to make the root is gone".to_string());
        }
        tx.execute(
            "UPDATE households SET root_node_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![root_node_id, timestamp, household_id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(album_ids) = album_ids {
        tx.execute(
            "DELETE FROM household_albums WHERE household_id = ?1",
            params![household_id],
        )
        .map_err(|e| e.to_string())?;
        for album_id in album_ids {
            tx.execute(
                "INSERT OR IGNORE INTO household_albums(household_id, album_id) VALUES(?1, ?2)",
                params![household_id, album_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete a graph. The objects and the links between them stay: they are facts
/// of the library, not of this graph.
pub fn delete_household_with_conn(
    conn: &mut Connection,
    household_id: i64,
) -> Result<bool, String> {
    let deleted = conn
        .execute(
            "DELETE FROM households WHERE id = ?1",
            params![household_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(deleted > 0)
}

/// Bring the named faces into the library as objects.
///
/// A name that the clustering made up ("Person 12") is not about anybody and
/// is skipped. A name that is already there keeps its object, so importing
/// twice does not make a second one.
pub fn import_names_with_conn(conn: &Connection, names: &[String]) -> Result<Vec<i64>, String> {
    let mut ids = Vec::new();
    for name in names {
        let trimmed = name.trim();
        if trimmed.is_empty() || crate::t_sqlite::Person::is_automatic_name(Some(trimmed)) {
            continue;
        }
        match anchor_owner(conn, trimmed)? {
            Some(node_id) => ids.push(node_id),
            None => {
                let node = HouseholdNode {
                    display_name: Some(trimmed.to_string()),
                    anchors: vec![trimmed.to_string()],
                    ..Default::default()
                };
                ids.push(upsert_node_with_conn(conn, &node)?);
            }
        }
    }
    Ok(ids)
}

/// Write one object, with its anchors.
pub fn upsert_node_with_conn(conn: &Connection, node: &HouseholdNode) -> Result<i64, String> {
    if !is_known_class(&node.kind) {
        return Err(format!("Unknown object class: {}", node.kind));
    }
    if !matches!(node.gender.as_str(), "male" | "female" | "unknown") {
        return Err(format!("Unknown gender: {}", node.gender));
    }

    // The anchors of an object: no empty name, no name the clustering made up,
    // and no name that already belongs to another object.
    let mut anchors: Vec<String> = Vec::new();
    for value in &node.anchors {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err("An anchor cannot be empty".to_string());
        }
        if crate::t_sqlite::Person::is_automatic_name(Some(trimmed)) {
            return Err(format!(
                "{trimmed} is a name the clustering made up; it cannot stand for a person"
            ));
        }
        if !anchors.iter().any(|kept| kept == trimmed) {
            anchors.push(trimmed.to_string());
        }
    }
    for value in &anchors {
        if let Some(owner) = anchor_owner(conn, value)? {
            if Some(owner) != node.id {
                return Err(format!(
                    "{value} already belongs to another object; a name stands for one person"
                ));
            }
        }
    }

    let timestamp = now();
    let node_id = match node.id {
        Some(id) => {
            if node_class(conn, id)?.is_none() {
                return Err(format!("The object {id} is gone"));
            }
            conn.execute(
                "UPDATE household_nodes
                 SET kind = ?1, display_name = ?2, gender = ?3, birth_date = ?4,
                     birth_place = ?5, notes = ?6, share_age = ?7, share_details = ?8,
                     updated_at = ?9
                 WHERE id = ?10",
                params![
                    node.kind,
                    node.display_name,
                    node.gender,
                    node.birth_date,
                    node.birth_place,
                    node.notes,
                    i64::from(node.share_age),
                    i64::from(node.share_details),
                    timestamp,
                    id
                ],
            )
            .map_err(|e| e.to_string())?;
            id
        }
        None => {
            conn.execute(
                "INSERT INTO household_nodes(
                     kind, display_name, gender, birth_date, birth_place, notes,
                     share_age, share_details, created_at, updated_at)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
                params![
                    node.kind,
                    node.display_name,
                    node.gender,
                    node.birth_date,
                    node.birth_place,
                    node.notes,
                    i64::from(node.share_age),
                    i64::from(node.share_details),
                    timestamp
                ],
            )
            .map_err(|e| format!("Failed to write the object: {e}"))?;
            conn.last_insert_rowid()
        }
    };

    conn.execute(
        "DELETE FROM household_node_anchors WHERE node_id = ?1",
        params![node_id],
    )
    .map_err(|e| e.to_string())?;
    for value in &anchors {
        conn.execute(
            "INSERT INTO household_node_anchors(node_id, kind, value, created_at)
             VALUES(?1, ?2, ?3, ?4)",
            params![node_id, ANCHOR_FACE_NAME, value, timestamp],
        )
        .map_err(|e| format!("Failed to tie the name {value} to the object: {e}"))?;
    }

    Ok(node_id)
}

/// Delete an object. The root of a graph cannot be deleted: the graph would
/// lose the person it is named after.
pub fn delete_node_with_conn(conn: &Connection, node_id: i64) -> Result<bool, String> {
    let is_root: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM households WHERE root_node_id = ?1)",
            params![node_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if is_root {
        return Err("The root of a graph cannot be deleted".to_string());
    }
    let deleted = conn
        .execute(
            "DELETE FROM household_nodes WHERE id = ?1",
            params![node_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(deleted > 0)
}

/// The members of a graph, replaced as a whole.
pub fn set_members_with_conn(
    conn: &Connection,
    household_id: i64,
    node_ids: &[i64],
) -> Result<(), String> {
    if !household_exists(conn, household_id)? {
        return Err("The graph is gone".to_string());
    }
    for node_id in node_ids {
        if node_class(conn, *node_id)?.is_none() {
            return Err(format!("The object {node_id} is gone"));
        }
    }
    conn.execute(
        "DELETE FROM household_members WHERE household_id = ?1",
        params![household_id],
    )
    .map_err(|e| e.to_string())?;
    for node_id in node_ids {
        conn.execute(
            "INSERT OR IGNORE INTO household_members(household_id, node_id) VALUES(?1, ?2)",
            params![household_id, node_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The links of a graph, replaced as a whole.
///
/// Every link that touches a member of the graph is replaced; links between
/// objects that are not in the graph are left alone. The whole batch is
/// checked before anything is written, so a batch with one bad link leaves the
/// library as it was.
pub fn set_edges_with_conn(
    conn: &Connection,
    household_id: i64,
    edges: &[HouseholdEdge],
) -> Result<(), String> {
    if !household_exists(conn, household_id)? {
        return Err("The graph is gone".to_string());
    }
    let members: HashSet<i64> = member_ids(conn, household_id)?.into_iter().collect();

    // Check every link before writing any of them.
    let mut prepared: Vec<(i64, i64, &'static RelationType, &HouseholdEdge)> = Vec::new();
    let mut seen: HashSet<(i64, i64, &str)> = HashSet::new();
    for edge in edges {
        let relation = relation_type(&edge.kind, edge.label.as_deref()).ok_or_else(|| {
            if edge.kind == "social" {
                "A social link needs a label the catalog knows".to_string()
            } else {
                format!("Unknown kind of link: {}", edge.kind)
            }
        })?;
        if !SOURCES.contains(&edge.source.as_str()) {
            return Err(format!("Unknown source of a link: {}", edge.source));
        }
        if edge.valid_from.is_some() && edge.valid_to.is_some() && edge.valid_from >= edge.valid_to
        {
            return Err("A link cannot end before it starts".to_string());
        }
        if edge.from_node == edge.to_node {
            return Err("A link cannot point at the same object".to_string());
        }
        let from_class = match node_class(conn, edge.from_node)? {
            Some(class) => class,
            None => return Err(format!("The object {} is gone", edge.from_node)),
        };
        let to_class = match node_class(conn, edge.to_node)? {
            Some(class) => class,
            None => return Err(format!("The object {} is gone", edge.to_node)),
        };
        if !relation_accepts_classes(relation, &from_class, &to_class) {
            return Err(format!(
                "A {} link does not connect {} objects to {} objects",
                relation.kind, relation.from, relation.to
            ));
        }
        let (from_node, to_node) = normalise_ends(relation, edge.from_node, edge.to_node);
        let key = (from_node, to_node, relation.label.unwrap_or(""));
        if !seen.insert(key) {
            return Err("The same link is in the list twice".to_string());
        }
        prepared.push((from_node, to_node, relation, edge));
    }

    // A parent link may not close a circle.
    let mut parents: Vec<(i64, i64)> = prepared
        .iter()
        .filter(|(_, _, relation, _)| relation.kind == "parent")
        .map(|(from_node, to_node, _, _)| (*from_node, *to_node))
        .collect();
    {
        let mut stmt = conn
            .prepare("SELECT from_node, to_node FROM household_edges WHERE kind = 'parent'")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (from_node, to_node) = row.map_err(|e| e.to_string())?;
            // Links between objects that are not in the graph stay; they are the
            // only ones that can still close a circle with the new ones.
            if !members.contains(&from_node) && !members.contains(&to_node) {
                parents.push((from_node, to_node));
            }
        }
    }
    if parents_form_a_cycle(&parents) {
        return Err("A parent link cannot close a circle".to_string());
    }

    // Replace the links that touch a member of the graph.
    let mut stmt = conn
        .prepare(
            "SELECT id, from_node, to_node FROM household_edges
             WHERE from_node IN (SELECT node_id FROM household_members WHERE household_id = ?1)
                OR to_node IN (SELECT node_id FROM household_members WHERE household_id = ?1)",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![household_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut replaced: Vec<i64> = Vec::new();
    for row in rows {
        replaced.push(row.map_err(|e| e.to_string())?.0);
    }
    drop(stmt);
    for edge_id in replaced {
        conn.execute(
            "DELETE FROM household_edges WHERE id = ?1",
            params![edge_id],
        )
        .map_err(|e| e.to_string())?;
    }

    let timestamp = now();
    for (from_node, to_node, relation, edge) in prepared {
        conn.execute(
            "INSERT INTO household_edges(
                 kind, from_node, to_node, label, term_override,
                 valid_from, valid_to, source, created_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                relation.kind,
                from_node,
                to_node,
                relation.label,
                edge.term_override,
                edge.valid_from,
                edge.valid_to,
                edge.source,
                timestamp
            ],
        )
        .map_err(|e| format!("Failed to write the link: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn library() -> Connection {
        Connection::open_in_memory().unwrap()
    }

    // ---- the write surface ----

    /// A library with the tables of the module and an album to point at.
    fn graph() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE albums(id INTEGER PRIMARY KEY, name TEXT);
             INSERT INTO albums VALUES(1, '家庭');",
        )
        .unwrap();
        ensure_schema(&conn).unwrap();
        conn
    }

    /// An object with one face name.
    fn person(conn: &Connection, name: &str) -> i64 {
        let node = HouseholdNode {
            display_name: Some(name.to_string()),
            anchors: vec![name.to_string()],
            ..Default::default()
        };
        upsert_node_with_conn(conn, &node).unwrap()
    }

    fn link(kind: &str, from_node: i64, to_node: i64, label: Option<&str>) -> HouseholdEdge {
        HouseholdEdge {
            kind: kind.to_string(),
            from_node,
            to_node,
            label: label.map(str::to_string),
            ..Default::default()
        }
    }

    fn node_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM household_nodes", [], |row| row.get(0))
            .unwrap()
    }

    fn edge_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM household_edges", [], |row| row.get(0))
            .unwrap()
    }

    fn member_count(conn: &Connection, household_id: i64) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM household_members WHERE household_id = ?1",
            [household_id],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn anchor_owner(conn: &Connection, value: &str) -> Option<i64> {
        conn.query_row(
            "SELECT node_id FROM household_node_anchors WHERE kind = 'face_name' AND value = ?1",
            [value],
            |row| row.get(0),
        )
        .ok()
    }

    #[test]
    fn importing_the_same_names_twice_keeps_one_object() {
        let conn = graph();
        let first =
            import_names_with_conn(&conn, &["小明".to_string(), "小红".to_string()]).unwrap();
        let second =
            import_names_with_conn(&conn, &["小明".to_string(), "小红".to_string()]).unwrap();
        assert_eq!(first, second);
        assert_eq!(node_count(&conn), 2);
    }

    #[test]
    fn a_face_name_cannot_anchor_two_objects() {
        let conn = graph();
        let ann = person(&conn, "小明");
        let other = HouseholdNode {
            display_name: Some("别人".to_string()),
            anchors: vec!["小明".to_string()],
            ..Default::default()
        };
        assert!(upsert_node_with_conn(&conn, &other).is_err());
        assert_eq!(anchor_owner(&conn, "小明"), Some(ann));
        assert_eq!(node_count(&conn), 1);
    }

    #[test]
    fn automatic_names_are_no_anchors() {
        let conn = graph();
        let imported = import_names_with_conn(
            &conn,
            &[
                "Person 3".to_string(),
                "   ".to_string(),
                "小明".to_string(),
            ],
        )
        .unwrap();
        assert_eq!(imported.len(), 1);
        assert_eq!(node_count(&conn), 1);
        let automatic = HouseholdNode {
            anchors: vec!["Person 3".to_string()],
            ..Default::default()
        };
        assert!(upsert_node_with_conn(&conn, &automatic).is_err());
    }

    #[test]
    fn the_root_of_a_graph_cannot_be_deleted() {
        let mut conn = graph();
        let household = create_household_with_conn(
            &mut conn,
            "某某家",
            &[1],
            "小明",
            &["小明".to_string(), "小红".to_string()],
        )
        .unwrap();
        let root: i64 = conn
            .query_row(
                "SELECT root_node_id FROM households WHERE id = ?1",
                [household],
                |row| row.get(0),
            )
            .unwrap();
        assert!(delete_node_with_conn(&conn, root).is_err());
        assert_eq!(node_count(&conn), 2);
        assert_eq!(member_count(&conn, household), 2);
    }

    #[test]
    fn deleting_a_graph_keeps_the_objects_and_the_links() {
        let mut conn = graph();
        let household = create_household_with_conn(
            &mut conn,
            "某某家",
            &[1],
            "小明",
            &["小明".to_string(), "小红".to_string()],
        )
        .unwrap();
        let ann: i64 = conn
            .query_row(
                "SELECT node_id FROM household_node_anchors WHERE value = '小明'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let hong: i64 = conn
            .query_row(
                "SELECT node_id FROM household_node_anchors WHERE value = '小红'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        set_edges_with_conn(&conn, household, &[link("spouse", ann, hong, None)]).unwrap();

        assert!(delete_household_with_conn(&mut conn, household).unwrap());

        assert_eq!(node_count(&conn), 2);
        assert_eq!(edge_count(&conn), 1);
        let graphs: i64 = conn
            .query_row("SELECT COUNT(*) FROM households", [], |row| row.get(0))
            .unwrap();
        assert_eq!(graphs, 0);
    }

    #[test]
    fn the_links_of_a_graph_are_replaced_as_a_whole() {
        let mut conn = graph();
        let ann = person(&conn, "小明");
        let hong = person(&conn, "小红");
        let child = person(&conn, "小小");
        let household = create_household_with_conn(
            &mut conn,
            "某某家",
            &[1],
            "小明",
            &["小明".to_string(), "小红".to_string(), "小小".to_string()],
        )
        .unwrap();
        set_edges_with_conn(&conn, household, &[link("spouse", ann, hong, None)]).unwrap();
        assert_eq!(edge_count(&conn), 1);

        set_edges_with_conn(&conn, household, &[link("parent", ann, child, None)]).unwrap();

        assert_eq!(edge_count(&conn), 1);
        let kind: String = conn
            .query_row("SELECT kind FROM household_edges", [], |row| row.get(0))
            .unwrap();
        assert_eq!(kind, "parent");
    }

    #[test]
    fn a_batch_with_a_bad_link_changes_nothing() {
        let mut conn = graph();
        let ann = person(&conn, "小明");
        let hong = person(&conn, "小红");
        let household = create_household_with_conn(
            &mut conn,
            "某某家",
            &[1],
            "小明",
            &["小明".to_string(), "小红".to_string()],
        )
        .unwrap();
        set_edges_with_conn(&conn, household, &[link("spouse", ann, hong, None)]).unwrap();

        let mut bad = link("sibling", ann, hong, None);
        bad.kind = "sibling".to_string();
        assert!(
            set_edges_with_conn(&conn, household, &[link("spouse", ann, hong, None), bad]).is_err()
        );

        assert_eq!(edge_count(&conn), 1);
        let kind: String = conn
            .query_row("SELECT kind FROM household_edges", [], |row| row.get(0))
            .unwrap();
        assert_eq!(kind, "spouse");
    }

    #[test]
    fn a_link_to_itself_is_refused() {
        let mut conn = graph();
        let ann = person(&conn, "小明");
        let household =
            create_household_with_conn(&mut conn, "某某家", &[1], "小明", &["小明".to_string()])
                .unwrap();
        assert!(set_edges_with_conn(&conn, household, &[link("spouse", ann, ann, None)]).is_err());
        assert_eq!(edge_count(&conn), 0);
    }

    #[test]
    fn a_parent_that_is_a_child_of_its_own_child_is_refused() {
        let mut conn = graph();
        let ann = person(&conn, "小明");
        let child = person(&conn, "小小");
        let grandchild = person(&conn, "小小小");
        let household = create_household_with_conn(
            &mut conn,
            "某某家",
            &[1],
            "小明",
            &["小明".to_string(), "小小".to_string(), "小小小".to_string()],
        )
        .unwrap();
        let cycle = vec![
            link("parent", ann, child, None),
            link("parent", child, grandchild, None),
            link("parent", grandchild, ann, None),
        ];
        assert!(set_edges_with_conn(&conn, household, &cycle).is_err());
        assert_eq!(edge_count(&conn), 0);
    }

    #[test]
    fn a_period_that_ends_before_it_starts_is_refused() {
        let mut conn = graph();
        let ann = person(&conn, "小明");
        let hong = person(&conn, "小红");
        let household = create_household_with_conn(
            &mut conn,
            "某某家",
            &[1],
            "小明",
            &["小明".to_string(), "小红".to_string()],
        )
        .unwrap();
        let mut edge = link("spouse", ann, hong, None);
        edge.valid_from = Some(2020);
        edge.valid_to = Some(2010);
        assert!(set_edges_with_conn(&conn, household, &[edge]).is_err());
        assert_eq!(edge_count(&conn), 0);
    }

    #[test]
    fn the_same_link_twice_in_one_batch_is_refused() {
        let mut conn = graph();
        let ann = person(&conn, "小明");
        let hong = person(&conn, "小红");
        let household = create_household_with_conn(
            &mut conn,
            "某某家",
            &[1],
            "小明",
            &["小明".to_string(), "小红".to_string()],
        )
        .unwrap();
        let both = vec![
            link("spouse", ann, hong, None),
            link("spouse", hong, ann, None),
        ];
        assert!(set_edges_with_conn(&conn, household, &both).is_err());
        assert_eq!(edge_count(&conn), 0);
    }

    #[test]
    fn a_link_must_use_a_kind_the_catalog_knows() {
        let mut conn = graph();
        let ann = person(&conn, "小明");
        let hong = person(&conn, "小红");
        let household = create_household_with_conn(
            &mut conn,
            "某某家",
            &[1],
            "小明",
            &["小明".to_string(), "小红".to_string()],
        )
        .unwrap();
        assert!(
            set_edges_with_conn(&conn, household, &[link("sibling", ann, hong, None)]).is_err()
        );
        assert!(set_edges_with_conn(&conn, household, &[link("social", ann, hong, None)]).is_err());
        assert!(
            set_edges_with_conn(&conn, household, &[link("social", ann, hong, Some("boss"))])
                .is_err()
        );
        assert!(
            set_edges_with_conn(
                &conn,
                household,
                &[link("social", ann, hong, Some("classmate"))]
            )
            .is_ok()
        );
    }

    #[test]
    fn a_symmetric_link_is_stored_with_the_smaller_id_first() {
        let mut conn = graph();
        let ann = person(&conn, "小明");
        let hong = person(&conn, "小红");
        let household = create_household_with_conn(
            &mut conn,
            "某某家",
            &[1],
            "小明",
            &["小明".to_string(), "小红".to_string()],
        )
        .unwrap();
        set_edges_with_conn(&conn, household, &[link("spouse", hong, ann, None)]).unwrap();
        let (from, to): (i64, i64) = conn
            .query_row(
                "SELECT from_node, to_node FROM household_edges",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(from, ann.min(hong));
        assert_eq!(to, ann.max(hong));
    }

    #[test]
    fn one_person_can_belong_to_two_graphs() {
        let mut conn = graph();
        let first =
            create_household_with_conn(&mut conn, "我家", &[1], "小明", &["小明".to_string()])
                .unwrap();
        let second = create_household_with_conn(
            &mut conn,
            "爷爷奶奶家",
            &[1],
            "小明",
            &["小明".to_string()],
        )
        .unwrap();
        assert_ne!(first, second);
        assert_eq!(node_count(&conn), 1);
        assert_eq!(member_count(&conn, first), 1);
        assert_eq!(member_count(&conn, second), 1);
    }

    #[test]
    fn creating_a_graph_sets_the_root_and_the_albums() {
        let mut conn = graph();
        let household = create_household_with_conn(
            &mut conn,
            "某某家",
            &[1],
            "小明",
            &["小明".to_string(), "小红".to_string()],
        )
        .unwrap();
        let (name, enabled, root): (String, i64, Option<i64>) = conn
            .query_row(
                "SELECT name, enabled, root_node_id FROM households WHERE id = ?1",
                [household],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(name, "某某家");
        assert_eq!(enabled, 1);
        let expected_root: i64 = conn
            .query_row(
                "SELECT node_id FROM household_node_anchors WHERE value = '小明'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(root, Some(expected_root));
        assert_eq!(member_count(&conn, household), 2);
        let albums: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM household_albums WHERE household_id = ?1",
                [household],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(albums, 1);
    }

    #[test]
    fn the_root_must_be_a_name_of_a_face() {
        let mut conn = graph();
        assert!(
            create_household_with_conn(
                &mut conn,
                "某某家",
                &[1],
                "不存在的人",
                &["小明".to_string()],
            )
            .is_err()
        );
    }

    #[test]
    fn the_members_of_a_graph_are_replaced_as_a_whole() {
        let mut conn = graph();
        let ann = person(&conn, "小明");
        let hong = person(&conn, "小红");
        let household = create_household_with_conn(
            &mut conn,
            "某某家",
            &[1],
            "小明",
            &["小明".to_string(), "小红".to_string()],
        )
        .unwrap();
        assert_eq!(member_count(&conn, household), 2);

        set_members_with_conn(&conn, household, &[ann]).unwrap();

        assert_eq!(member_count(&conn, household), 1);
        let still: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM household_members WHERE household_id = ?1 AND node_id = ?2",
                [household, hong],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(still, 0);
    }

    #[test]
    fn a_member_must_be_an_object_of_the_library() {
        let mut conn = graph();
        let household =
            create_household_with_conn(&mut conn, "某某家", &[1], "小明", &["小明".to_string()])
                .unwrap();
        assert!(set_members_with_conn(&conn, household, &[999]).is_err());
    }

    // ---- the derivation ----

    /// A small graph to derive from.
    struct Family {
        nodes: Vec<DerivationNode>,
        edges: Vec<DerivationEdge>,
    }

    impl Family {
        fn new() -> Family {
            Family {
                nodes: Vec::new(),
                edges: Vec::new(),
            }
        }

        fn person(&mut self, id: i64, gender: &str, year: Option<i32>) -> i64 {
            self.nodes.push(DerivationNode {
                id,
                gender: gender.to_string(),
                birth_year: year,
            });
            id
        }

        /// A parent and a child.
        fn parent(&mut self, parent: i64, child: i64) -> i64 {
            self.edges.push(DerivationEdge {
                kind: "parent".to_string(),
                from_node: parent,
                to_node: child,
                label: None,
                term_override: None,
                valid_from: None,
                valid_to: None,
                source: "user".to_string(),
            });
            parent
        }

        fn spouse(&mut self, a: i64, b: i64) -> i64 {
            self.edges.push(DerivationEdge {
                kind: "spouse".to_string(),
                from_node: a,
                to_node: b,
                label: None,
                term_override: None,
                valid_from: None,
                valid_to: None,
                source: "user".to_string(),
            });
            a
        }

        fn social(&mut self, label: &str, a: i64, b: i64) -> i64 {
            self.edges.push(DerivationEdge {
                kind: "social".to_string(),
                from_node: a,
                to_node: b,
                label: Some(label.to_string()),
                term_override: None,
                valid_from: None,
                valid_to: None,
                source: "user".to_string(),
            });
            a
        }

        fn derive(&self, year: Option<i64>) -> Derivation<'_> {
            Derivation::new(&self.nodes, &self.edges, year)
        }

        fn word(&self, a: i64, b: i64, year: Option<i64>) -> Option<String> {
            self.derive(year).term(a, b).map(|relation| relation.term)
        }
    }

    #[test]
    fn a_parent_is_the_father_or_the_mother_of_the_child() {
        let mut family = Family::new();
        let father = family.person(1, "male", Some(1980));
        let mother = family.person(2, "female", Some(1982));
        let child = family.person(3, "male", Some(2011));
        family.parent(father, child);
        family.parent(mother, child);
        assert_eq!(family.word(father, child, None).as_deref(), Some("父亲"));
        assert_eq!(family.word(mother, child, None).as_deref(), Some("母亲"));
        assert_eq!(family.word(child, father, None).as_deref(), Some("儿子"));
    }

    #[test]
    fn a_spouse_is_the_husband_or_the_wife() {
        let mut family = Family::new();
        let wife = family.person(1, "female", Some(1980));
        let husband = family.person(2, "male", Some(1978));
        family.spouse(husband, wife);
        assert_eq!(family.word(husband, wife, None).as_deref(), Some("丈夫"));
        assert_eq!(family.word(wife, husband, None).as_deref(), Some("妻子"));
    }

    #[test]
    fn the_grandparents_come_from_the_fathers_side_or_the_mothers_side() {
        let mut family = Family::new();
        // Two sets of grandparents: the father's and the mother's.
        let grandpa = family.person(1, "male", Some(1950));
        let grandma = family.person(2, "female", Some(1952));
        let grandpa_of_mother = family.person(3, "male", Some(1948));
        let grandma_of_mother = family.person(4, "female", Some(1950));
        let father = family.person(5, "male", Some(1980));
        let mother = family.person(6, "female", Some(1982));
        let child = family.person(7, "male", Some(2011));
        family.parent(grandpa, father);
        family.parent(grandma, father);
        family.parent(grandpa_of_mother, mother);
        family.parent(grandma_of_mother, mother);
        family.parent(father, child);
        family.parent(mother, child);
        assert_eq!(family.word(grandpa, child, None).as_deref(), Some("爷爷"));
        assert_eq!(family.word(grandma, child, None).as_deref(), Some("奶奶"));
        assert_eq!(
            family.word(grandpa_of_mother, child, None).as_deref(),
            Some("外公")
        );
        assert_eq!(
            family.word(grandma_of_mother, child, None).as_deref(),
            Some("外婆")
        );
    }

    #[test]
    fn the_grandchildren_come_from_the_sons_side_or_the_daughters_side() {
        let mut family = Family::new();
        let father = family.person(1, "male", Some(1980));
        let mother = family.person(2, "female", Some(1982));
        let son = family.person(3, "male", Some(2005));
        let daughter = family.person(4, "female", Some(2008));
        let grandson_of_son = family.person(5, "male", Some(2030));
        let grandson_of_daughter = family.person(6, "male", Some(2032));
        family.parent(father, son);
        family.parent(mother, son);
        family.parent(father, daughter);
        family.parent(mother, daughter);
        family.parent(son, grandson_of_son);
        family.parent(daughter, grandson_of_daughter);
        // The line of the son stays in the family, the line of the daughter
        // leaves it.
        assert_eq!(
            family.word(grandson_of_son, father, None).as_deref(),
            Some("孙子")
        );
        assert_eq!(
            family.word(grandson_of_son, mother, None).as_deref(),
            Some("孙子")
        );
        assert_eq!(
            family.word(grandson_of_daughter, father, None).as_deref(),
            Some("外孙")
        );
        assert_eq!(
            family.word(grandson_of_daughter, mother, None).as_deref(),
            Some("外孙")
        );
    }

    #[test]
    fn siblings_tell_their_age_when_both_birth_years_are_known() {
        let mut family = Family::new();
        let father = family.person(1, "male", Some(1980));
        let mother = family.person(2, "female", Some(1982));
        let older = family.person(3, "male", Some(2005));
        let younger = family.person(4, "female", Some(2008));
        for child in [older, younger] {
            family.parent(father, child);
            family.parent(mother, child);
        }
        assert_eq!(family.word(older, younger, None).as_deref(), Some("哥哥"));
        assert_eq!(family.word(younger, older, None).as_deref(), Some("妹妹"));
    }

    #[test]
    fn siblings_without_the_years_stay_neutral() {
        let mut family = Family::new();
        let father = family.person(1, "male", None);
        let mother = family.person(2, "female", None);
        let older = family.person(3, "male", None);
        let younger = family.person(4, "female", None);
        for child in [older, younger] {
            family.parent(father, child);
            family.parent(mother, child);
        }
        assert_eq!(family.word(older, younger, None).as_deref(), Some("兄弟"));
        assert_eq!(family.word(younger, older, None).as_deref(), Some("姐妹"));
    }

    #[test]
    fn the_uncles_and_aunts_are_named_by_the_side_and_the_age() {
        let mut family = Family::new();
        // The father's side.
        let grandfather = family.person(1, "male", Some(1950));
        let grandmother = family.person(2, "female", Some(1952));
        let older_brother = family.person(3, "male", Some(1975));
        let younger_brother = family.person(4, "male", Some(1985));
        let aunt = family.person(5, "female", Some(1978));
        let father = family.person(6, "male", Some(1980));
        // The mother's side.
        let grandfather_of_mother = family.person(7, "male", Some(1948));
        let grandmother_of_mother = family.person(8, "female", Some(1950));
        let uncle = family.person(9, "male", Some(1975));
        let aunt_of_mother = family.person(10, "female", Some(1976));
        let mother = family.person(11, "female", Some(1982));
        let child = family.person(12, "male", Some(2011));
        for sibling in [older_brother, younger_brother, aunt, father] {
            family.parent(grandfather, sibling);
            family.parent(grandmother, sibling);
        }
        for sibling in [uncle, aunt_of_mother, mother] {
            family.parent(grandfather_of_mother, sibling);
            family.parent(grandmother_of_mother, sibling);
        }
        family.parent(father, child);
        family.parent(mother, child);
        assert_eq!(
            family.word(older_brother, child, None).as_deref(),
            Some("伯伯")
        );
        assert_eq!(
            family.word(younger_brother, child, None).as_deref(),
            Some("叔叔")
        );
        assert_eq!(family.word(aunt, child, None).as_deref(), Some("姑姑"));
        assert_eq!(family.word(uncle, child, None).as_deref(), Some("舅舅"));
        assert_eq!(
            family.word(aunt_of_mother, child, None).as_deref(),
            Some("姨母")
        );
    }

    #[test]
    fn the_uncles_without_the_years_stay_neutral() {
        let mut family = Family::new();
        let grandfather = family.person(1, "male", None);
        let grandmother = family.person(2, "female", None);
        let father = family.person(3, "male", None);
        let uncle = family.person(4, "male", None);
        let child = family.person(5, "male", None);
        family.parent(grandfather, uncle);
        family.parent(grandmother, uncle);
        family.parent(grandfather, father);
        family.parent(grandmother, father);
        family.parent(father, child);
        assert_eq!(
            family.word(uncle, child, None).as_deref(),
            Some("伯父或叔父")
        );
    }

    #[test]
    fn cousins_are_named_by_whether_the_grandparents_are_married() {
        let mut family = Family::new();
        let grandfather = family.person(1, "male", Some(1950));
        let grandmother = family.person(2, "female", Some(1952));
        let father = family.person(3, "male", Some(1980));
        let mother = family.person(4, "female", Some(1982));
        let uncle = family.person(5, "male", Some(1975));
        let aunt = family.person(6, "female", Some(1977));
        let child = family.person(7, "male", Some(2011));
        let cousin = family.person(8, "male", Some(2013));
        family.spouse(grandfather, grandmother);
        for sibling in [father, uncle] {
            family.parent(grandfather, sibling);
            family.parent(grandmother, sibling);
        }
        for sibling in [mother, aunt] {
            family.parent(grandfather, sibling);
            family.parent(grandmother, sibling);
        }
        family.parent(father, child);
        family.parent(uncle, cousin);
        assert_eq!(
            family.word(cousin, child, None).as_deref(),
            Some("堂兄弟姐妹")
        );
    }

    #[test]
    fn the_parents_of_the_spouse_are_the_in_laws() {
        let mut family = Family::new();
        let father_of_wife = family.person(1, "male", Some(1950));
        let mother_of_wife = family.person(2, "female", Some(1952));
        let wife = family.person(3, "female", Some(1982));
        let husband = family.person(4, "male", Some(1980));
        let father_of_husband = family.person(5, "male", Some(1948));
        let mother_of_husband = family.person(6, "female", Some(1950));
        family.parent(father_of_wife, wife);
        family.parent(mother_of_wife, wife);
        family.parent(father_of_husband, husband);
        family.parent(mother_of_husband, husband);
        family.spouse(husband, wife);
        // The husband sees the parents of his wife as the in-laws.
        assert_eq!(
            family.word(father_of_wife, husband, None).as_deref(),
            Some("岳父")
        );
        assert_eq!(
            family.word(mother_of_wife, husband, None).as_deref(),
            Some("岳母")
        );
        // The wife sees the parents of her husband the other way round.
        assert_eq!(
            family.word(father_of_husband, wife, None).as_deref(),
            Some("公公")
        );
        assert_eq!(
            family.word(mother_of_husband, wife, None).as_deref(),
            Some("婆婆")
        );
        // The shorter way round wins: a father is a father to his own child.
        assert_eq!(
            family.word(father_of_wife, wife, None).as_deref(),
            Some("父亲")
        );
    }

    #[test]
    fn the_spouse_of_the_child_is_the_daughter_or_the_son_in_law() {
        let mut family = Family::new();
        let mother = family.person(1, "female", Some(1982));
        let son = family.person(2, "male", Some(2005));
        let daughter = family.person(3, "female", Some(2008));
        let wife_of_son = family.person(4, "female", Some(2006));
        let husband_of_daughter = family.person(5, "male", Some(2007));
        family.parent(mother, son);
        family.parent(mother, daughter);
        family.spouse(son, wife_of_son);
        family.spouse(daughter, husband_of_daughter);
        assert_eq!(
            family.word(wife_of_son, mother, None).as_deref(),
            Some("儿媳")
        );
        assert_eq!(
            family.word(husband_of_daughter, mother, None).as_deref(),
            Some("女婿")
        );
    }

    #[test]
    fn the_spouse_of_the_sibling_is_the_sister_or_the_brother_in_law() {
        let mut family = Family::new();
        let father = family.person(1, "male", Some(1980));
        let mother = family.person(2, "female", Some(1982));
        let older_brother = family.person(3, "male", Some(2005));
        let younger_sister = family.person(4, "female", Some(2014));
        let wife_of_brother = family.person(5, "female", Some(2006));
        let husband_of_sister = family.person(6, "male", Some(2007));
        let child = family.person(7, "male", Some(2011));
        for sibling in [older_brother, younger_sister, child] {
            family.parent(father, sibling);
            family.parent(mother, sibling);
        }
        family.spouse(older_brother, wife_of_brother);
        family.spouse(younger_sister, husband_of_sister);
        assert_eq!(
            family.word(wife_of_brother, child, None).as_deref(),
            Some("嫂子")
        );
        assert_eq!(
            family.word(husband_of_sister, child, None).as_deref(),
            Some("妹夫")
        );
    }

    #[test]
    fn the_spouse_of_the_grandchild_is_the_granddaughter_or_the_grandson_in_law() {
        let mut family = Family::new();
        let father = family.person(1, "male", Some(1980));
        let son = family.person(2, "male", Some(2005));
        let grandson = family.person(3, "male", Some(2030));
        let wife_of_grandson = family.person(4, "female", Some(2031));
        family.parent(father, son);
        family.parent(son, grandson);
        family.spouse(grandson, wife_of_grandson);
        assert_eq!(
            family.word(wife_of_grandson, father, None).as_deref(),
            Some("孙媳")
        );
    }

    #[test]
    fn a_social_link_does_not_take_part_in_the_derivation() {
        let mut family = Family::new();
        let father = family.person(1, "male", Some(1980));
        let mother = family.person(2, "female", Some(1982));
        let child = family.person(3, "male", Some(2011));
        let classmate = family.person(4, "female", Some(2011));
        family.parent(father, child);
        family.parent(mother, child);
        family.social("classmate", child, classmate);
        // The classmate is not a relative.
        assert_eq!(family.word(classmate, child, None).as_deref(), Some("同学"));
        assert_eq!(family.word(child, child, None), None);
    }

    #[test]
    fn a_partner_is_a_lover_and_not_a_relative() {
        let mut family = Family::new();
        let woman = family.person(1, "female", Some(1990));
        let man = family.person(2, "male", Some(1988));
        family.social("partner", woman, man);
        assert_eq!(family.word(woman, man, None).as_deref(), Some("恋人"));
    }

    #[test]
    fn the_partner_and_the_spouse_of_one_year_leave_the_spouse() {
        let mut family = Family::new();
        let wife = family.person(1, "female", Some(1990));
        let husband = family.person(2, "male", Some(1988));
        family.social("partner", wife, husband);
        family.spouse(husband, wife);
        assert_eq!(family.word(wife, husband, None).as_deref(), Some("妻子"));
    }

    #[test]
    fn a_link_that_ends_before_the_photo_leaves_only_the_ex_partner() {
        let mut family = Family::new();
        let father_in_law = family.person(1, "male", Some(1950));
        let wife = family.person(2, "female", Some(1980));
        let husband = family.person(3, "male", Some(1978));
        family.parent(father_in_law, wife);
        family.spouse(husband, wife);
        // The marriage ended in 2010; the photo is from 2015.
        family.edges.last_mut().unwrap().valid_to = Some(2010);
        assert_eq!(
            family.word(wife, husband, Some(2015)).as_deref(),
            Some("前妻")
        );
        // The father of an ex-wife is not a father-in-law any more.
        assert_eq!(family.word(father_in_law, husband, Some(2015)), None);
    }

    #[test]
    fn a_link_that_has_not_started_yet_is_not_used() {
        let mut family = Family::new();
        let wife = family.person(1, "female", Some(1990));
        let husband = family.person(2, "male", Some(1988));
        family.spouse(husband, wife);
        family.edges.last_mut().unwrap().valid_from = Some(2020);
        assert_eq!(family.word(wife, husband, Some(2015)), None);
    }

    #[test]
    fn a_link_that_is_only_suggested_is_not_used() {
        let mut family = Family::new();
        let father = family.person(1, "male", Some(1980));
        let child = family.person(2, "male", Some(2011));
        family.parent(father, child);
        family.edges.last_mut().unwrap().source = "suggested".to_string();
        assert_eq!(family.word(father, child, None), None);
    }

    #[test]
    fn the_word_of_the_user_wins_over_the_derived_one() {
        let mut family = Family::new();
        let stepmother = family.person(1, "female", Some(1980));
        let child = family.person(2, "male", Some(2011));
        family.parent(stepmother, child);
        family.edges.last_mut().unwrap().term_override = Some("继母".to_string());
        assert_eq!(
            family.word(stepmother, child, None).as_deref(),
            Some("继母")
        );
    }

    #[test]
    fn a_relation_that_cannot_be_derived_is_not_written() {
        let mut family = Family::new();
        let stranger = family.person(1, "male", Some(1980));
        let other = family.person(2, "female", Some(1982));
        assert_eq!(family.word(stranger, other, None), None);
    }

    #[test]
    fn the_age_is_counted_by_the_year_of_the_photo() {
        assert_eq!(age_at(Some(2011), 2021), Some(10));
        assert_eq!(age_at(None, 2021), None);
        assert_eq!(birth_year_of(Some("2011")), Some(2011));
        assert_eq!(birth_year_of(Some("2011-05")), Some(2011));
        assert_eq!(birth_year_of(Some("2011-05-07")), Some(2011));
        assert_eq!(birth_year_of(Some("")), None);
        assert_eq!(birth_year_of(None), None);
    }

    #[test]
    fn a_library_without_the_tables_has_no_graph() {
        let conn = library();
        assert!(!tables_present(&conn).unwrap());
    }

    #[test]
    fn creating_the_tables_can_be_done_twice() {
        let conn = library();
        ensure_schema(&conn).unwrap();
        assert!(tables_present(&conn).unwrap());
        ensure_schema(&conn).unwrap();
        for table in TABLES {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "{table} is missing");
        }
    }

    #[test]
    fn the_tables_hold_the_columns_the_design_names() {
        let conn = library();
        ensure_schema(&conn).unwrap();
        let columns = |table: &str| -> Vec<String> {
            let mut stmt = conn
                .prepare(&format!("SELECT name FROM pragma_table_info('{table}')"))
                .unwrap();
            let rows = stmt.query_map([], |row| row.get::<_, String>(0)).unwrap();
            rows.collect::<Result<Vec<_>, _>>().unwrap()
        };
        for name in [
            "id",
            "kind",
            "display_name",
            "gender",
            "birth_date",
            "birth_place",
            "notes",
            "share_age",
            "share_details",
        ] {
            assert!(columns("household_nodes").contains(&name.to_string()));
        }
        for name in ["node_id", "kind", "value"] {
            assert!(columns("household_node_anchors").contains(&name.to_string()));
        }
        for name in ["name", "enabled", "root_node_id"] {
            assert!(columns("households").contains(&name.to_string()));
        }
        for name in [
            "kind",
            "from_node",
            "to_node",
            "label",
            "term_override",
            "valid_from",
            "valid_to",
            "source",
        ] {
            assert!(columns("household_edges").contains(&name.to_string()));
        }
    }

    #[test]
    fn the_catalog_knows_the_links_the_design_names() {
        assert!(is_known_kind("parent"));
        assert!(is_known_kind("spouse"));
        assert!(is_known_kind("social"));
        assert!(!is_known_kind("sibling"));
        assert!(!is_known_kind(""));
        for label in [
            "classmate",
            "teacher",
            "friend",
            "colleague",
            "neighbour",
            "partner",
        ] {
            assert!(is_known_label(label), "{label} is missing");
        }
        assert!(!is_known_label("boss"));
        assert!(!is_known_label(""));
    }

    #[test]
    fn a_link_without_its_label_is_not_in_the_catalog() {
        assert!(relation_type("parent", None).is_some());
        assert!(relation_type("spouse", None).is_some());
        assert!(relation_type("social", None).is_none());
        assert!(relation_type("social", Some("classmate")).is_some());
        assert!(relation_type("social", Some("boss")).is_none());
        assert!(relation_type("sibling", None).is_none());
    }

    #[test]
    fn only_the_kinship_links_take_part_in_the_derivation() {
        let generative: Vec<&str> = RELATION_TYPES
            .iter()
            .filter(|relation| relation.generative)
            .map(|relation| relation.kind)
            .collect();
        assert_eq!(generative, vec!["parent", "spouse"]);
    }

    #[test]
    fn a_symmetric_link_is_stored_once_with_the_smaller_id_first() {
        let spouse = relation_type("spouse", None).unwrap();
        assert_eq!(normalise_ends(spouse, 7, 3), (3, 7));
        assert_eq!(normalise_ends(spouse, 3, 7), (3, 7));
        let classmate = relation_type("social", Some("classmate")).unwrap();
        assert_eq!(normalise_ends(classmate, 9, 4), (4, 9));
    }

    #[test]
    fn a_directed_link_keeps_its_order() {
        let parent = relation_type("parent", None).unwrap();
        assert_eq!(normalise_ends(parent, 7, 3), (7, 3));
        let teacher = relation_type("social", Some("teacher")).unwrap();
        assert_eq!(normalise_ends(teacher, 9, 4), (9, 4));
    }

    #[test]
    fn only_the_teacher_link_reads_backwards_as_a_student() {
        let teacher = relation_type("social", Some("teacher")).unwrap();
        assert_eq!(teacher.inverse_label, Some("student"));
        let classmate = relation_type("social", Some("classmate")).unwrap();
        assert_eq!(classmate.inverse_label, None);
    }

    #[test]
    fn a_link_only_connects_the_classes_the_catalog_names() {
        let classmate = relation_type("social", Some("classmate")).unwrap();
        assert!(relation_accepts_classes(classmate, "person", "person"));
        // A link between a person and a place is not in the catalog.
        assert!(!relation_accepts_classes(classmate, "person", "place"));
        assert!(!relation_accepts_classes(classmate, "place", "person"));
        assert!(!relation_accepts_classes(classmate, "animal", "person"));
    }

    #[test]
    fn only_person_is_an_object_class_for_now() {
        assert!(is_known_class("person"));
        assert!(!is_known_class("place"));
        assert!(!is_known_class("event"));
        assert!(!is_known_class(""));
    }

    #[test]
    fn one_pair_of_objects_can_hold_one_link_of_a_kind() {
        let conn = library();
        ensure_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO household_nodes(id, kind, created_at, updated_at) VALUES (1, 'person', 0, 0), (2, 'person', 0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO household_edges(kind, from_node, to_node, source, created_at)
             VALUES ('spouse', 1, 2, 'user', 0)",
            [],
        )
        .unwrap();
        let second = conn.execute(
            "INSERT INTO household_edges(kind, from_node, to_node, source, created_at)
             VALUES ('spouse', 1, 2, 'user', 0)",
            [],
        );
        assert!(second.is_err(), "the same link was stored twice");
        // A social link of the same pair is a different link.
        conn.execute(
            "INSERT INTO household_edges(kind, from_node, to_node, label, source, created_at)
             VALUES ('social', 1, 2, 'classmate', 'user', 0)",
            [],
        )
        .unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM household_edges", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }
}
