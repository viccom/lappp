//! The household graph: objects, the links between them, and the relations
//! those links stand for.
//!
//! The module is independent: a library that never uses it has no tables at
//! all, and every read path asks `tables_present` before it touches the
//! library. The tables are created when the first graph is written, not by a
//! migration, so a library without a graph does not carry six empty tables.

use rusqlite::Connection;

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
pub(crate) fn tables_present(conn: &Connection) -> Result<bool, String> {
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
pub(crate) fn ensure_schema(conn: &Connection) -> Result<(), String> {
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
pub(crate) fn relation_type(kind: &str, label: Option<&str>) -> Option<&'static RelationType> {
    RELATION_TYPES
        .iter()
        .find(|relation| relation.kind == kind && relation.label == label)
}

/// Whether the catalog knows this kind of link.
pub(crate) fn is_known_kind(kind: &str) -> bool {
    RELATION_TYPES.iter().any(|relation| relation.kind == kind)
}

/// Whether the catalog knows this social label.
pub(crate) fn is_known_label(label: &str) -> bool {
    RELATION_TYPES
        .iter()
        .any(|relation| relation.label == Some(label))
}

/// Whether the catalog knows this object class.
pub(crate) fn is_known_class(name: &str) -> bool {
    NODE_CLASSES.iter().any(|class| class.name == name)
}

/// Whether a link may connect two objects of these classes.
pub(crate) fn relation_accepts_classes(
    relation: &RelationType,
    from_class: &str,
    to_class: &str,
) -> bool {
    relation.from == from_class && relation.to == to_class
}

/// The two ends of a link, in the order they are stored.
///
/// A symmetric link is stored once, with the smaller object id first. A
/// directed link keeps the order it was given: a teacher is stored as
/// teacher → student, never the other way round.
pub(crate) fn normalise_ends(relation: &RelationType, from_node: i64, to_node: i64) -> (i64, i64) {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn library() -> Connection {
        Connection::open_in_memory().unwrap()
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
