//! Linking people to a name the user gave.
//!
//! The people panel can put several people rows under one name: the faces of
//! every linked row move to the person that carries the name, and the rows
//! that are left empty disappear. Because a name now belongs to a face rather
//! than to a row (see `t_cluster`), the link survives the next re-index.

use crate::t_sqlite::{Face, Person};
use base64::{Engine, engine::general_purpose};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

/// A person the user named, with how many faces it has.
#[derive(Debug, Clone, Serialize)]
pub struct PersonTarget {
    pub id: i64,
    pub name: String,
    pub count: i64,
    pub thumbnail: Option<String>,
}

/// What a link did.
#[derive(Debug, Clone, Serialize)]
pub struct PersonMergeResult {
    pub target_person_id: i64,
    pub merged_person_ids: Vec<i64>,
    pub moved_face_ids: Vec<i64>,
}

/// Whether a name is one the user typed, or one the clustering made up.
pub(crate) fn is_user_given_name(name: Option<&str>) -> bool {
    match name {
        None => false,
        Some(name) => {
            let trimmed = name.trim();
            !trimmed.is_empty() && !trimmed.to_lowercase().starts_with("person ")
        }
    }
}

/// The people a link can point at: the ones the user named.
pub(crate) fn list_targets_with_conn(conn: &Connection) -> Result<Vec<PersonTarget>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.name, COUNT(f.id) AS count, p.thumbnail
             FROM persons p
             LEFT JOIN faces f ON f.person_id = p.id
             WHERE p.name IS NOT NULL AND TRIM(p.name) <> ''
               AND LOWER(TRIM(p.name)) NOT LIKE 'person %'
             GROUP BY p.id
             ORDER BY p.name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let thumbnail: Option<Vec<u8>> = row.get(3)?;
            Ok(PersonTarget {
                id: row.get(0)?,
                name: row.get(1)?,
                count: row.get(2)?,
                thumbnail: thumbnail
                    .as_ref()
                    .map(|data| general_purpose::STANDARD.encode(data)),
            })
        })
        .map_err(|e| e.to_string())?;
    let mut targets = Vec::new();
    for row in rows {
        targets.push(row.map_err(|e| e.to_string())?);
    }
    Ok(targets)
}

/// Put the faces of the given people under the target person.
///
/// The target must carry a name the user typed. People that carry the same
/// name are linked as well: they were the same person all along.
pub(crate) fn merge_persons_with_conn(
    conn: &mut Connection,
    person_ids: &[i64],
    target_person_id: i64,
    indexing: bool,
) -> Result<PersonMergeResult, String> {
    if indexing {
        return Err("Faces are being indexed, try again when it is done".to_string());
    }

    let target_name: Option<String> = conn
        .query_row(
            "SELECT name FROM persons WHERE id = ?1",
            params![target_person_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(target_name) = target_name else {
        return Err("The person to link to does not exist".to_string());
    };
    if !is_user_given_name(Some(target_name.as_str())) {
        return Err("The person to link to has no name yet".to_string());
    }

    // The rows to link: the ones asked for, without the target and without
    // repeats, plus every other row that carries the same name.
    let mut sources: Vec<i64> = Vec::new();
    for person_id in person_ids {
        if *person_id == target_person_id || sources.contains(person_id) {
            continue;
        }
        let exists: Option<i64> = conn
            .query_row(
                "SELECT id FROM persons WHERE id = ?1",
                params![person_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let Some(exists) = exists else {
            return Err("One of the people to link does not exist".to_string());
        };
        sources.push(exists);
    }
    let same_name: Vec<i64> = {
        let mut stmt = conn
            .prepare(
                "SELECT id FROM persons
                 WHERE id <> ?1 AND name IS NOT NULL AND TRIM(name) = TRIM(?2)",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![target_person_id, target_name], |row| {
                row.get::<_, i64>(0)
            })
            .map_err(|e| e.to_string())?;
        let mut ids = Vec::new();
        for row in rows {
            let id = row.map_err(|e| e.to_string())?;
            if !sources.contains(&id) {
                ids.push(id);
            }
        }
        ids
    };
    sources.extend(same_name);

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut moved_face_ids = Vec::new();
    for source_id in &sources {
        let face_ids: Vec<i64> = {
            let mut stmt = tx
                .prepare("SELECT id FROM faces WHERE person_id = ?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![source_id], |row| row.get::<_, i64>(0))
                .map_err(|e| e.to_string())?;
            let mut ids = Vec::new();
            for row in rows {
                ids.push(row.map_err(|e| e.to_string())?);
            }
            ids
        };
        for face_id in face_ids {
            Face::assign_to_person_with_conn(&tx, face_id, target_person_id)?;
            moved_face_ids.push(face_id);
        }
        tx.execute("DELETE FROM persons WHERE id = ?1", params![source_id])
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(PersonMergeResult {
        target_person_id,
        merged_person_ids: sources,
        moved_face_ids,
    })
}

/// Move the given faces into a person of their own, without a name.
///
/// This is how a link is undone: the faces that were linked go back to being
/// faces nobody named.
pub(crate) fn move_faces_to_new_person_with_conn(
    conn: &mut Connection,
    face_ids: &[i64],
) -> Result<i64, String> {
    let mut wanted: Vec<i64> = Vec::new();
    for face_id in face_ids {
        if !wanted.contains(face_id) {
            wanted.push(*face_id);
        }
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let person_id = Person::create_with_conn(&tx, None)?;
    let mut moved = 0;
    for face_id in &wanted {
        let exists: Option<i64> = tx
            .query_row(
                "SELECT id FROM faces WHERE id = ?1",
                params![face_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if exists.is_none() {
            continue;
        }
        Face::assign_to_person_with_conn(&tx, *face_id, person_id)?;
        moved += 1;
    }
    if moved == 0 {
        let _ = tx.rollback();
        return Err("Those faces are gone already".to_string());
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(person_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCHEMA: &str = "CREATE TABLE persons(
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, cover_face_id INTEGER,
            thumbnail BLOB, created_at INTEGER);
        CREATE TABLE faces(
            id INTEGER PRIMARY KEY AUTOINCREMENT, file_id INTEGER, bbox TEXT, embedding BLOB,
            person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL, created_at INTEGER);";

    fn library() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn
    }

    fn add_person(conn: &Connection, name: Option<&str>) -> i64 {
        conn.execute(
            "INSERT INTO persons (name, created_at) VALUES (?1, 0)",
            params![name],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn add_face(conn: &Connection, file_id: i64, person_id: Option<i64>) -> i64 {
        conn.execute(
            "INSERT INTO faces (file_id, person_id, created_at) VALUES (?1, ?2, 0)",
            params![file_id, person_id],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    /// The name over each face, by face id.
    fn names_by_face(conn: &Connection) -> Vec<(i64, Option<String>)> {
        let mut stmt = conn
            .prepare(
                "SELECT f.id, p.name FROM faces f
                 LEFT JOIN persons p ON p.id = f.person_id
                 ORDER BY f.id",
            )
            .unwrap();
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .unwrap();
        rows.collect::<Result<Vec<_>, _>>().unwrap()
    }

    /// One row per person: its name and how many faces it has.
    fn people(conn: &Connection) -> Vec<(Option<String>, i64)> {
        let mut stmt = conn
            .prepare(
                "SELECT p.name, COUNT(f.id) FROM persons p
                 LEFT JOIN faces f ON f.person_id = p.id
                 GROUP BY p.id ORDER BY p.id",
            )
            .unwrap();
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, Option<String>>(0)?, row.get::<_, i64>(1)?))
            })
            .unwrap();
        rows.collect::<Result<Vec<_>, _>>().unwrap()
    }

    #[test]
    fn linking_moves_the_faces_and_drops_the_empty_rows() {
        let mut conn = library();
        let ann = add_person(&conn, Some("Ann"));
        let fragment = add_person(&conn, Some("Person 2"));
        let first = add_face(&conn, 1, Some(fragment));
        let second = add_face(&conn, 2, Some(fragment));

        let result = merge_persons_with_conn(&mut conn, &[fragment], ann, false).unwrap();

        assert_eq!(result.target_person_id, ann);
        assert_eq!(result.merged_person_ids, vec![fragment]);
        assert_eq!(result.moved_face_ids, vec![first, second]);
        assert_eq!(people(&conn), vec![(Some("Ann".to_string()), 2)]);
        assert_eq!(
            names_by_face(&conn),
            vec![
                (first, Some("Ann".to_string())),
                (second, Some("Ann".to_string()))
            ]
        );
    }

    #[test]
    fn the_person_to_link_to_must_carry_a_name_the_user_gave() {
        let mut conn = library();
        let unnamed = add_person(&conn, None);
        let automatic = add_person(&conn, Some("Person 2"));
        let source = add_person(&conn, Some("Person 3"));
        add_face(&conn, 1, Some(source));

        assert!(merge_persons_with_conn(&mut conn, &[source], unnamed, false).is_err());
        assert!(merge_persons_with_conn(&mut conn, &[source], automatic, false).is_err());
        assert_eq!(people(&conn).len(), 3);
    }

    #[test]
    fn a_person_that_does_not_exist_is_refused() {
        let mut conn = library();
        let ann = add_person(&conn, Some("Ann"));
        assert!(merge_persons_with_conn(&mut conn, &[999], ann, false).is_err());
        assert!(merge_persons_with_conn(&mut conn, &[ann], 999, false).is_err());
    }

    #[test]
    fn rows_that_carry_the_same_name_are_linked_as_well() {
        let mut conn = library();
        let ann = add_person(&conn, Some("Ann"));
        let also_ann = add_person(&conn, Some("Ann"));
        let fragment = add_person(&conn, Some("Person 3"));
        add_face(&conn, 1, Some(also_ann));
        add_face(&conn, 2, Some(fragment));

        let result = merge_persons_with_conn(&mut conn, &[fragment], ann, false).unwrap();

        assert!(result.merged_person_ids.contains(&also_ann));
        assert!(result.merged_person_ids.contains(&fragment));
        assert_eq!(people(&conn), vec![(Some("Ann".to_string()), 2)]);
    }

    #[test]
    fn linking_is_refused_while_faces_are_being_indexed() {
        let mut conn = library();
        let ann = add_person(&conn, Some("Ann"));
        let fragment = add_person(&conn, Some("Person 2"));
        add_face(&conn, 1, Some(fragment));

        let error = merge_persons_with_conn(&mut conn, &[fragment], ann, true).unwrap_err();

        assert!(error.contains("index"), "unhelpful message: {error}");
        assert_eq!(people(&conn).len(), 2);
        assert_eq!(
            names_by_face(&conn),
            vec![(1, Some("Person 2".to_string()))]
        );
    }

    #[test]
    fn the_target_can_never_be_one_of_the_rows_being_linked() {
        let mut conn = library();
        let ann = add_person(&conn, Some("Ann"));
        add_face(&conn, 1, Some(ann));

        let result = merge_persons_with_conn(&mut conn, &[ann, ann], ann, false).unwrap();

        assert!(result.merged_person_ids.is_empty());
        assert!(result.moved_face_ids.is_empty());
        assert_eq!(people(&conn), vec![(Some("Ann".to_string()), 1)]);
    }

    #[test]
    fn the_targets_are_the_people_the_user_named() {
        let conn = library();
        let ann = add_person(&conn, Some("Ann"));
        let bob = add_person(&conn, Some("Bob"));
        add_person(&conn, Some("Person 4"));
        add_person(&conn, None);
        add_face(&conn, 1, Some(ann));
        add_face(&conn, 2, Some(ann));
        add_face(&conn, 3, Some(bob));

        let targets = list_targets_with_conn(&conn).unwrap();

        assert_eq!(targets.len(), 2);
        assert_eq!(targets[0].name, "Ann");
        assert_eq!(targets[0].count, 2);
        assert_eq!(targets[1].name, "Bob");
        assert_eq!(targets[1].count, 1);
    }

    #[test]
    fn faces_can_be_moved_into_a_person_of_their_own_without_a_name() {
        let mut conn = library();
        let ann = add_person(&conn, Some("Ann"));
        let first = add_face(&conn, 1, Some(ann));
        let second = add_face(&conn, 2, Some(ann));

        let person_id = move_faces_to_new_person_with_conn(&mut conn, &[first, second]).unwrap();

        assert!(person_id > 0);
        assert_eq!(people(&conn), vec![(Some("Ann".to_string()), 0), (None, 2)]);
        assert_eq!(names_by_face(&conn), vec![(first, None), (second, None)]);
    }

    #[test]
    fn moving_faces_that_are_gone_reports_it_instead_of_moving_nothing() {
        let mut conn = library();
        let error = move_faces_to_new_person_with_conn(&mut conn, &[404]).unwrap_err();
        assert!(error.contains("gone"), "unhelpful message: {error}");
        assert!(people(&conn).is_empty());
    }

    #[test]
    fn faces_that_are_gone_are_skipped_while_the_others_still_move() {
        let mut conn = library();
        let ann = add_person(&conn, Some("Ann"));
        let face = add_face(&conn, 1, Some(ann));

        let person_id = move_faces_to_new_person_with_conn(&mut conn, &[face, 404]).unwrap();

        assert!(person_id > 0);
        assert_eq!(people(&conn), vec![(Some("Ann".to_string()), 0), (None, 1)]);
    }
}
