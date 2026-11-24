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
///
/// The rule itself lives with the people in `t_sqlite`, so the prompt, the
/// search index and this module cannot drift apart.
pub(crate) fn is_user_given_name(name: Option<&str>) -> bool {
    !Person::is_automatic_name(name)
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

/// Verification against a copy of a real library.
///
/// The copy is made by the test, the library it came from is never touched.
/// Point LAP_FACE_OWNERSHIP_DB at a snapshot of a library to run this.
#[cfg(test)]
mod real_library_tests {
    use super::*;
    use crate::t_sqlite::{TEST_DB_PATH, open_conn};
    use std::path::PathBuf;

    struct TempLibrary(PathBuf);
    impl Drop for TempLibrary {
        fn drop(&mut self) {
            TEST_DB_PATH.with(|path| path.replace(None));
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// The people of the library: name and face count, by name.
    fn people_by_name(conn: &Connection) -> Vec<(Option<String>, i64)> {
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

    /// How many people carry a name the user gave.
    fn user_named(conn: &Connection) -> usize {
        let mut stmt = conn
            .prepare(
                "SELECT COUNT(*) FROM persons
                 WHERE name IS NOT NULL AND TRIM(name) <> ''
                   AND LOWER(TRIM(name)) NOT LIKE 'person %'",
            )
            .unwrap();
        stmt.query_row([], |row| row.get::<_, usize>(0)).unwrap()
    }

    fn counts(conn: &Connection) -> (usize, usize) {
        let persons: usize = conn
            .query_row("SELECT COUNT(*) FROM persons", [], |row| row.get(0))
            .unwrap();
        let faces: usize = conn
            .query_row(
                "SELECT COUNT(*) FROM faces WHERE person_id IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        (persons, faces)
    }

    #[test]
    #[ignore = "needs a library snapshot: set LAP_FACE_OWNERSHIP_DB"]
    fn a_link_survives_a_re_index_and_a_cancelled_one_changes_nothing() {
        let _serial = crate::t_storage::db_migration_test_lock();
        let source = std::env::var("LAP_FACE_OWNERSHIP_DB").expect("LAP_FACE_OWNERSHIP_DB");
        let root = TempLibrary(
            std::env::temp_dir().join(format!("lap-ownership-{}", uuid::Uuid::new_v4())),
        );
        std::fs::create_dir(&root.0).unwrap();
        let copy = root.0.join("catalog.db");
        std::fs::copy(&source, &copy).unwrap();
        TEST_DB_PATH.with(|path| {
            path.replace(Some(copy.to_str().unwrap().to_string()));
        });

        // What the library looks like to start with.
        let (persons_before, faces_before) = {
            let conn = open_conn().unwrap();
            let counts = counts(&conn);
            eprintln!(
                "start: {} people ({} named by the user), {} faces",
                counts.0,
                user_named(&conn),
                counts.1
            );
            assert!(counts.1 > 0, "the snapshot has no faces");
            counts
        };

        // A re-index must not lose a name.
        crate::t_cluster::cluster_faces(0.55, |_| {}, || false).unwrap();
        {
            let conn = open_conn().unwrap();
            let (persons, faces) = counts(&conn);
            let named = user_named(&conn);
            eprintln!(
                "after re-index: {} people ({} named by the user), {} faces",
                persons, named, faces
            );
            assert_eq!(faces, faces_before, "a re-index lost faces");
            assert!(named > 0, "a re-index lost every name");
        }

        // A cancelled re-index must change nothing.
        {
            let conn = open_conn().unwrap();
            let before = people_by_name(&conn);
            drop(conn);
            crate::t_cluster::cluster_faces(0.55, |_| {}, || true).unwrap();
            let conn = open_conn().unwrap();
            assert_eq!(
                people_by_name(&conn),
                before,
                "a cancelled re-index changed the people"
            );
        }

        // Link the biggest unnamed cluster to the biggest named person.
        let (target_id, target_name, target_faces, source_id, source_faces) = {
            let conn = open_conn().unwrap();
            let mut stmt = conn
                .prepare(
                    "SELECT p.id, p.name, COUNT(f.id) AS count FROM persons p
                     JOIN faces f ON f.person_id = p.id
                     WHERE p.name IS NOT NULL AND TRIM(p.name) <> ''
                       AND LOWER(TRIM(p.name)) NOT LIKE 'person %'
                     GROUP BY p.id ORDER BY count DESC LIMIT 1",
                )
                .unwrap();
            let (target_id, target_name, target_faces): (i64, String, i64) = stmt
                .query_row([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .unwrap();
            let mut stmt = conn
                .prepare(
                    "SELECT p.id, COUNT(f.id) AS count FROM persons p
                     JOIN faces f ON f.person_id = p.id
                     WHERE p.name IS NULL OR TRIM(p.name) = ''
                        OR LOWER(TRIM(p.name)) LIKE 'person %'
                     GROUP BY p.id ORDER BY count DESC LIMIT 1",
                )
                .unwrap();
            let (source_id, source_faces): (i64, i64) = stmt
                .query_row([], |row| Ok((row.get(0)?, row.get(1)?)))
                .unwrap();
            eprintln!(
                "linking the unnamed cluster with {} faces to the person with {} faces",
                source_faces, target_faces
            );
            (
                target_id,
                target_name,
                target_faces,
                source_id,
                source_faces,
            )
        };

        {
            let mut conn = open_conn().unwrap();
            let result =
                merge_persons_with_conn(&mut conn, &[source_id], target_id, false).unwrap();
            assert_eq!(result.moved_face_ids.len() as i64, source_faces);
            assert_eq!(result.merged_person_ids, vec![source_id]);
        }
        {
            let conn = open_conn().unwrap();
            let row: (i64, Option<String>) = conn
                .query_row(
                    "SELECT COUNT(f.id), p.name FROM persons p
                     JOIN faces f ON f.person_id = p.id WHERE p.id = ?1 GROUP BY p.id",
                    params![target_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap();
            assert_eq!(row.0, target_faces + source_faces);
            assert_eq!(row.1, Some(target_name.clone()));
        }

        // The link has to survive the next re-index.
        crate::t_cluster::cluster_faces(0.55, |_| {}, || false).unwrap();
        {
            let conn = open_conn().unwrap();
            let row: (i64, Option<String>) = conn
                .query_row(
                    "SELECT COUNT(f.id), p.name FROM persons p
                     JOIN faces f ON f.person_id = p.id WHERE p.name = ?1 GROUP BY p.id",
                    params![target_name],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap();
            eprintln!("after the second re-index: {} faces under the name", row.0);
            assert_eq!(
                row.0,
                target_faces + source_faces,
                "the link did not survive"
            );
        }

        // Undoing the link gives the faces a person of their own again. The
        // person is found by name: a re-index gives the rows new ids.
        {
            let conn = open_conn().unwrap();
            let face_ids: Vec<i64> = {
                let mut stmt = conn
                    .prepare(
                        "SELECT f.id FROM faces f
                         JOIN persons p ON p.id = f.person_id
                         WHERE p.name = ?1",
                    )
                    .unwrap();
                let rows = stmt
                    .query_map(params![target_name], |row| row.get::<_, i64>(0))
                    .unwrap();
                let mut ids = Vec::new();
                for row in rows {
                    ids.push(row.unwrap());
                }
                ids
            };
            let moved = face_ids.len();
            let mut conn = open_conn().unwrap();
            let new_person = move_faces_to_new_person_with_conn(&mut conn, &face_ids).unwrap();
            let name: Option<String> = conn
                .query_row(
                    "SELECT name FROM persons WHERE id = ?1",
                    params![new_person],
                    |row| row.get(0),
                )
                .unwrap();
            assert!(name.is_none(), "the new person got a name");
            let still: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM faces WHERE person_id = ?1",
                    params![new_person],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(still, moved as i64);
            eprintln!(
                "undo: {} faces moved back into a person without a name",
                still
            );
        }

        let (persons_after, faces_after) = {
            let conn = open_conn().unwrap();
            counts(&conn)
        };
        eprintln!(
            "end: {} people (was {}), {} faces (was {})",
            persons_after, persons_before, faces_after, faces_before
        );
        assert_eq!(faces_after, faces_before, "faces went missing");
    }
}
