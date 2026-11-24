use crate::t_common;
use crate::t_sqlite::{Face, Person, open_conn};
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};

/// Clustering progress information
#[derive(Clone, serde::Serialize)]
pub struct ClusterProgress {
    pub phase: String, // "graph", "iterate", "converged", "assign", "thumbnail"
    pub current: usize,
    pub total: usize,
}

/// Calculate cosine distance between two PRE-PARSED embeddings
/// Distance = 1.0 - Cosine Similarity
/// NOTE: Assumes input vectors are already normalized!
fn cosine_distance(emb1: &[f32], emb2: &[f32]) -> f32 {
    // Dot product of normalized vectors = cosine similarity
    let dot_product: f32 = emb1.iter().zip(emb2.iter()).map(|(x, y)| x * y).sum();

    // Clamp similarity to [-1.0, 1.0] to handle floating point errors
    let similarity = dot_product.clamp(-1.0, 1.0);
    1.0 - similarity
}

/// Helper: Parse raw byte embedding to normalized f32 vector
fn parse_embedding(bytes: &[u8]) -> Option<Vec<f32>> {
    // Embedding bytes should be tightly packed f32 values.
    // If not, skip this embedding instead of panicking.
    if bytes.is_empty() || bytes.len() % 4 != 0 {
        return None;
    }
    let emb_vec: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|chunk| {
            let arr = [chunk[0], chunk[1], chunk[2], chunk[3]];
            f32::from_le_bytes(arr)
        })
        .collect();

    // Normalize
    let norm: f32 = emb_vec.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        Some(emb_vec.iter().map(|x| x / norm).collect())
    } else {
        None
    }
}

/// Edge in the similarity graph
#[derive(Clone)]
struct Edge {
    to: usize,   // Target node index
    weight: f32, // Edge weight (similarity = 1 - distance)
}

/// Insert edge into candidate list, maintaining at most max_edges entries sorted by weight descending.
/// If list is full and new weight is smaller than the smallest, it is dropped.
fn insert_top_k(candidates: &mut Vec<(usize, f32)>, edge: (usize, f32), max_edges: usize) {
    if candidates.len() < max_edges {
        candidates.push(edge);
        candidates.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    } else {
        // Find the smallest weight (last element after sort)
        if let Some(&(_, min_weight)) = candidates.last() {
            if edge.1 > min_weight {
                candidates.pop();
                candidates.push(edge);
                candidates
                    .sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            }
        }
    }
}

/// Re-cluster all faces and write the result.
///
/// The library is written only once, after the clustering finished:
/// 1. Read which face carries which name, and every face. Nothing is written yet.
/// 2. Cluster in memory (`compute_clusters`). A cancelled run returns here and
///    leaves the people exactly as they were.
/// 3. Swap the people in one transaction (`restore_persons_with_conn`).
/// 4. Regenerate the thumbnails.
pub fn cluster_faces<F, C>(
    threshold: f32,
    mut progress_fn: F,
    is_cancelled_fn: C,
) -> Result<usize, String>
where
    F: FnMut(ClusterProgress),
    C: Fn() -> bool,
{
    // 1. Snapshot user-given names (face_id -> name) and read every face.
    //    Auto-generated "Person N" rows are excluded by the query.
    let named_faces = Face::get_named_person_snapshot()?;
    let slim_faces = Face::get_all_for_clustering()?;

    // 2. Cluster in memory; the library is not touched.
    let Some(clusters) =
        compute_clusters(&slim_faces, threshold, &mut progress_fn, is_cancelled_fn)?
    else {
        return Ok(0);
    };
    let total_clusters = clusters.len();

    // 3. Swap the people in one transaction. With no face at all this only
    //    clears the people, as it did before.
    progress_fn(ClusterProgress {
        phase: "assign".to_string(),
        current: 0,
        total: total_clusters,
    });
    let mut conn = open_conn()?;
    let assigned = restore_persons_with_conn(&mut conn, &slim_faces, &clusters, &named_faces)?;
    drop(conn);
    if slim_faces.is_empty() {
        return Ok(assigned);
    }
    progress_fn(ClusterProgress {
        phase: "assign".to_string(),
        current: total_clusters,
        total: total_clusters,
    });

    // 4. Generate thumbnails
    progress_fn(ClusterProgress {
        phase: "thumbnail".to_string(),
        current: 0,
        total: total_clusters,
    });

    Person::update_all_thumbnails()?;

    progress_fn(ClusterProgress {
        phase: "thumbnail".to_string(),
        current: total_clusters,
        total: total_clusters,
    });

    Ok(assigned)
}

/// (face_id, file_id, embedding bytes): all the clustering needs to know about a face.
pub(crate) type SlimFace = (i64, i64, Option<Vec<u8>>);

/// Split all faces into clusters without touching the library. `None` when cancelled.
///
/// Memory-optimized:
/// 1. Uses slim face data (id, file_id, embedding_bytes) instead of full Face structs
/// 2. Prunes candidate edges to Top-K during build (not after), bounding memory at N * K_NEIGHBORS
/// 3. Pre-parses all embeddings once to avoid allocations in inner loop
pub(crate) fn compute_clusters<F, C>(
    slim_faces: &[SlimFace],
    threshold: f32,
    mut progress_fn: F,
    is_cancelled_fn: C,
) -> Result<Option<Vec<Vec<usize>>>, String>
where
    F: FnMut(ClusterProgress),
    C: Fn() -> bool,
{
    const K_NEIGHBORS: usize = t_common::K_NEIGHBORS;

    let n = slim_faces.len();

    // 3. Pre-parse embeddings (do this once)
    let parsed_embeddings: Vec<Option<Vec<f32>>> = slim_faces
        .iter()
        .map(|(_, _, embedding_bytes)| embedding_bytes.as_deref().and_then(parse_embedding))
        .collect();

    // 4. Build K-NN Graph with early Top-K pruning
    //    candidate_lists memory is bounded at N * K_NEIGHBORS entries
    let mut candidate_lists: Vec<Vec<(usize, f32)>> = vec![Vec::new(); n];
    let total_pairs = n.saturating_mul(n.saturating_sub(1)) / 2;
    let mut pairs_done: usize = 0;
    let mut last_pct = 0;

    for i in 0..n {
        // Check for cancellation
        if is_cancelled_fn() {
            return Ok(None);
        }

        if let Some(emb_i) = &parsed_embeddings[i] {
            for j in (i + 1)..n {
                if let Some(emb_j) = &parsed_embeddings[j] {
                    // Faces in the same file cannot be edges (prevents merging distinct people in same photo)
                    if slim_faces[i].1 == slim_faces[j].1 {
                        pairs_done += 1;
                        continue;
                    }

                    let dist = cosine_distance(emb_i, emb_j);

                    if dist < threshold {
                        let weight = 1.0 - dist;
                        // Square weight to punish weak links further
                        let adjusted_weight = weight * weight;

                        insert_top_k(&mut candidate_lists[i], (j, adjusted_weight), K_NEIGHBORS);
                        insert_top_k(&mut candidate_lists[j], (i, adjusted_weight), K_NEIGHBORS);
                    }
                }
                pairs_done += 1;
            }
        } else {
            pairs_done += n.saturating_sub(i + 1);
        }

        // Report progress every 5%
        let current_pct = if total_pairs > 0 {
            pairs_done * 100 / total_pairs
        } else {
            100
        };
        if current_pct >= last_pct + 5 || pairs_done == total_pairs {
            progress_fn(ClusterProgress {
                phase: "graph".to_string(),
                current: current_pct,
                total: 100,
            });
            last_pct = current_pct;
        }
    }

    // 5. Build final graph from pruned candidate lists (edges already Top-K)
    let mut graph: Vec<Vec<Edge>> = vec![Vec::new(); n];

    for (i, candidates) in candidate_lists.iter().enumerate() {
        for &(to, weight) in candidates {
            graph[i].push(Edge { to, weight });
        }
    }

    // Free graph-building allocations before Chinese Whispers
    drop(candidate_lists);
    drop(parsed_embeddings);

    // 6. Run Chinese Whispers Algorithm
    let mut labels: Vec<usize> = (0..n).collect();
    // Deterministic node order (face-id order). The previous random shuffle
    // made cluster results differ run-to-run on identical data.
    let order: Vec<usize> = (0..n).collect();
    let max_iterations = 20;

    for iter in 0..max_iterations {
        // Check for cancellation
        if is_cancelled_fn() {
            return Ok(None);
        }

        let mut changed = false;

        progress_fn(ClusterProgress {
            phase: "iterate".to_string(),
            current: iter + 1,
            total: max_iterations,
        });

        for &node in &order {
            if graph[node].is_empty() {
                continue;
            }

            // Count weighted votes
            let mut label_weights: HashMap<usize, f32> = HashMap::new();
            for edge in &graph[node] {
                let neighbor_label = labels[edge.to];
                *label_weights.entry(neighbor_label).or_insert(0.0) += edge.weight;
            }

            // Find best label; ties break toward the smaller label so the
            // result is deterministic (HashMap iteration order is not).
            let mut votes: Vec<(usize, f32)> = label_weights.into_iter().collect();
            votes.sort_by(|a, b| {
                a.1.partial_cmp(&b.1)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then(b.0.cmp(&a.0))
            });
            let best_label = votes
                .last()
                .map(|&(label, _)| label)
                .unwrap_or(labels[node]);

            if labels[node] != best_label {
                labels[node] = best_label;
                changed = true;
            }
        }

        if !changed {
            progress_fn(ClusterProgress {
                phase: "converged".to_string(),
                current: iter + 1,
                total: max_iterations,
            });
            break;
        }
    }

    // Check for cancellation before assignment
    if is_cancelled_fn() {
        return Ok(None);
    }

    // 7. Collect clusters
    let mut cluster_map: HashMap<usize, Vec<usize>> = HashMap::new();
    for (i, &label) in labels.iter().enumerate() {
        // if !graph[i].is_empty() {
        cluster_map.entry(label).or_default().push(i);
        // }
    }
    drop(graph);
    drop(labels);
    drop(order);

    // Filter clusters; sort by first face index so "Person N" numbering is
    //    stable across runs (HashMap iteration order is not).
    const MIN_SAMPLES: usize = t_common::MIN_SAMPLES;
    let mut valid_clusters: Vec<_> = cluster_map
        .into_iter()
        .filter(|(_, face_indices)| face_indices.len() >= MIN_SAMPLES)
        .collect();
    valid_clusters.sort_by_key(|(_, face_indices)| face_indices[0]);

    Ok(Some(
        valid_clusters
            .into_iter()
            .map(|(_, face_indices)| face_indices)
            .collect(),
    ))
}

/// Write a clustering result. A name is the user's statement about one face, so
/// it stays with that face; the clusters only group the faces nobody named yet.
///
/// Every cluster lists all of its faces, named or not.
pub(crate) fn restore_persons_with_conn(
    conn: &mut Connection,
    faces: &[SlimFace],
    clusters: &[Vec<usize>],
    named_faces: &HashMap<i64, String>,
) -> Result<usize, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    Face::reset_all_assignments_with_conn(&tx)?;

    // The person that already stands for a name: one row per name.
    let mut person_of_name: HashMap<&str, i64> = HashMap::new();
    let mut total_assigned = 0;

    // A face that has a name goes back to it, whichever cluster it landed in.
    for (face_id, _, _) in faces {
        let Some(name) = named_faces.get(face_id) else {
            continue;
        };
        let person_id = match person_of_name.get(name.as_str()) {
            Some(id) => *id,
            None => {
                let id = Person::create_with_conn(&tx, Some(name.as_str()))?;
                person_of_name.insert(name.as_str(), id);
                id
            }
        };
        Face::assign_to_person_with_conn(&tx, *face_id, person_id)?;
        total_assigned += 1;
    }

    // A face nobody named follows its cluster.
    for (cluster_idx, cluster) in clusters.iter().enumerate() {
        let names_in_cluster: HashSet<&str> = cluster
            .iter()
            .filter_map(|&i| named_faces.get(&faces[i].0).map(String::as_str))
            .collect();
        // One name in the cluster: follow it, so new photos of that person
        // join. More than one: the algorithm mixed two named people, so these
        // faces wait for the user instead of going to the larger side.
        let follow = match names_in_cluster.len() {
            1 => names_in_cluster
                .iter()
                .next()
                .and_then(|name| person_of_name.get(name).copied()),
            _ => None,
        };
        let mut own_person: Option<i64> = None;
        for &i in cluster {
            let face_id = faces[i].0;
            if named_faces.contains_key(&face_id) {
                continue;
            }
            let person_id = match follow {
                Some(id) => id,
                None => match own_person {
                    Some(id) => id,
                    None => {
                        let id = Person::create_with_conn(
                            &tx,
                            Some(&format!("Person {}", cluster_idx + 1)),
                        )?;
                        own_person = Some(id);
                        id
                    }
                },
            };
            Face::assign_to_person_with_conn(&tx, face_id, person_id)?;
            total_assigned += 1;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(total_assigned)
}

/// The rule before names stuck to faces, kept so the test can state it: most
/// votes wins; ties break to the lexicographically smallest name.
#[cfg(test)]
fn plurality_name<'a>(votes: &HashMap<&'a str, usize>) -> Option<&'a str> {
    votes
        .iter()
        .max_by(|a, b| a.1.cmp(b.1).then_with(|| b.0.cmp(a.0)))
        .map(|(name, _)| *name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::t_sqlite::{TEST_DB_PATH, open_conn};
    use rusqlite::{Connection, OptionalExtension, params};
    use std::path::PathBuf;

    #[test]
    fn plurality_picks_most_votes_and_breaks_ties_deterministically() {
        let mut votes: HashMap<&str, usize> = HashMap::new();
        votes.insert("b", 3);
        votes.insert("a", 3);
        votes.insert("c", 1);
        // tie between a/b -> lexicographically smaller wins
        assert_eq!(plurality_name(&votes), Some("a"));
        votes.insert("c", 4);
        assert_eq!(plurality_name(&votes), Some("c"));
        let empty: HashMap<&str, usize> = HashMap::new();
        assert_eq!(plurality_name(&empty), None);
    }

    // ---- helpers ----

    /// `persons` and `faces` as the library has them, minus what these tests never read.
    const SCHEMA: &str = "CREATE TABLE persons(
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, cover_face_id INTEGER,
            thumbnail BLOB, created_at INTEGER);
        CREATE TABLE faces(
            id INTEGER PRIMARY KEY AUTOINCREMENT, file_id INTEGER, bbox TEXT, embedding BLOB,
            person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL, created_at INTEGER);";

    /// A unit vector with its single 1.0 on `axis`, stored the way faces are stored.
    fn embedding(axis: usize) -> Option<Vec<u8>> {
        let mut vector = vec![0f32; 512];
        vector[axis] = 1.0;
        Some(vector.iter().flat_map(|x| x.to_le_bytes()).collect())
    }

    /// `per_group` faces looking one way and as many looking another way; no two share a file.
    fn two_groups(per_group: usize) -> Vec<SlimFace> {
        (0..per_group * 2)
            .map(|i| {
                (
                    i as i64 + 1,
                    i as i64 + 1,
                    embedding(if i < per_group { 0 } else { 1 }),
                )
            })
            .collect()
    }

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
            "INSERT INTO faces (file_id, embedding, person_id, created_at) VALUES (?1, ?2, ?3, 0)",
            params![file_id, embedding(0), person_id],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    /// Every face as `get_all_for_clustering` hands them out, minus the embeddings.
    fn faces_of(conn: &Connection) -> Vec<SlimFace> {
        let mut stmt = conn
            .prepare("SELECT id, file_id FROM faces ORDER BY id")
            .unwrap();
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, None))
            })
            .unwrap();
        rows.collect::<Result<Vec<_>, _>>().unwrap()
    }

    /// What the library says after a run: the name over each face, by face id.
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

    /// The rule before names stuck to faces: a cluster takes the name most of its named faces carry.
    fn old_rule(
        faces: &[SlimFace],
        clusters: &[Vec<usize>],
        named: &HashMap<i64, String>,
    ) -> Vec<Option<String>> {
        let mut names = vec![None; faces.len()];
        for (cluster_idx, cluster) in clusters.iter().enumerate() {
            let mut votes: HashMap<&str, usize> = HashMap::new();
            for &i in cluster {
                if let Some(name) = named.get(&faces[i].0) {
                    *votes.entry(name.as_str()).or_insert(0) += 1;
                }
            }
            let name = plurality_name(&votes)
                .map(str::to_string)
                .unwrap_or_else(|| format!("Person {}", cluster_idx + 1));
            for &i in cluster {
                names[i] = Some(name.clone());
            }
        }
        names
    }

    // ---- names stick to faces ----

    #[test]
    fn faces_in_a_mixed_cluster_keep_their_own_names() {
        let mut conn = library();
        let ann = add_person(&conn, Some("Ann"));
        let bob = add_person(&conn, Some("Bob"));
        let ann_face = add_face(&conn, 1, Some(ann));
        let bob_face = add_face(&conn, 2, Some(bob));
        let stranger = add_face(&conn, 3, None);
        let named = Face::get_named_person_snapshot_with_conn(&conn).unwrap();
        let faces = faces_of(&conn);

        restore_persons_with_conn(&mut conn, &faces, &[vec![0, 1, 2]], &named).unwrap();

        assert_eq!(
            names_by_face(&conn),
            vec![
                (ann_face, Some("Ann".to_string())),
                (bob_face, Some("Bob".to_string())),
                (stranger, Some("Person 1".to_string())),
            ]
        );
    }

    #[test]
    fn clusters_that_carry_the_same_name_share_one_person() {
        let mut conn = library();
        let ann = add_person(&conn, Some("Ann"));
        add_face(&conn, 1, Some(ann));
        add_face(&conn, 2, Some(ann));
        let also_ann = add_person(&conn, Some("Ann"));
        add_face(&conn, 3, Some(also_ann));
        let named = Face::get_named_person_snapshot_with_conn(&conn).unwrap();
        let faces = faces_of(&conn);

        restore_persons_with_conn(&mut conn, &faces, &[vec![0, 1], vec![2]], &named).unwrap();

        assert_eq!(people(&conn), vec![(Some("Ann".to_string()), 3)]);
    }

    #[test]
    fn unnamed_faces_in_a_cluster_with_a_single_name_follow_that_name() {
        let mut conn = library();
        let ann = add_person(&conn, Some("Ann"));
        add_face(&conn, 1, Some(ann));
        add_face(&conn, 2, None);
        add_face(&conn, 3, None);
        let named = Face::get_named_person_snapshot_with_conn(&conn).unwrap();
        let faces = faces_of(&conn);

        restore_persons_with_conn(&mut conn, &faces, &[vec![0, 1, 2]], &named).unwrap();

        assert_eq!(people(&conn), vec![(Some("Ann".to_string()), 3)]);
    }

    #[test]
    fn without_shared_or_mixed_names_the_result_is_what_the_old_rule_gave() {
        let mut conn = library();
        let ann = add_person(&conn, Some("Ann"));
        add_face(&conn, 1, Some(ann));
        let bob = add_person(&conn, Some("Bob"));
        add_face(&conn, 2, Some(bob));
        add_face(&conn, 3, Some(bob));
        add_face(&conn, 4, None);
        add_face(&conn, 5, None);
        add_face(&conn, 6, None);
        let named = Face::get_named_person_snapshot_with_conn(&conn).unwrap();
        let faces = faces_of(&conn);
        // Ann with a face nobody named; Bob with two; and a cluster nobody named.
        let clusters = vec![vec![0, 4], vec![1, 2, 3], vec![5]];

        restore_persons_with_conn(&mut conn, &faces, &clusters, &named).unwrap();

        let actual: Vec<Option<String>> = names_by_face(&conn)
            .into_iter()
            .map(|(_, name)| name)
            .collect();
        assert_eq!(actual, old_rule(&faces, &clusters, &named));
    }

    #[test]
    fn a_cancelled_run_leaves_the_people_as_they_were() {
        let _serial = crate::t_storage::db_migration_test_lock();
        struct TempLibrary(PathBuf);
        impl Drop for TempLibrary {
            fn drop(&mut self) {
                TEST_DB_PATH.with(|path| path.replace(None));
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let root = TempLibrary(
            std::env::temp_dir().join(format!("lap-cluster-cancel-{}", uuid::Uuid::new_v4())),
        );
        std::fs::create_dir(&root.0).unwrap();
        TEST_DB_PATH.with(|path| {
            path.replace(Some(
                root.0.join("catalog.db").to_str().unwrap().to_string(),
            ))
        });
        {
            let conn = open_conn().unwrap();
            conn.execute_batch(SCHEMA).unwrap();
            conn.execute(
                "INSERT INTO persons (id, name, created_at) VALUES (1, 'Ann', 0)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO faces (file_id, embedding, person_id, created_at) VALUES (1, ?1, 1, 0)",
                params![embedding(0)],
            )
            .unwrap();
        }

        let assigned = cluster_faces(0.55, |_| {}, || true).unwrap();

        let conn = open_conn().unwrap();
        let people: i64 = conn
            .query_row("SELECT COUNT(*) FROM persons", [], |row| row.get(0))
            .unwrap();
        let name: Option<String> = conn
            .query_row("SELECT name FROM persons WHERE id = 1", [], |row| {
                row.get(0)
            })
            .optional()
            .unwrap();
        let owner: Option<i64> = conn
            .query_row("SELECT person_id FROM faces", [], |row| {
                row.get::<_, Option<i64>>(0)
            })
            .optional()
            .unwrap()
            .flatten();
        assert_eq!(
            (assigned, people, name.as_deref(), owner),
            (0, 1, Some("Ann"), Some(1))
        );
    }

    // ---- clustering itself ----

    #[test]
    fn the_same_faces_cluster_the_same_way_twice() {
        let faces = two_groups(3);
        let first = compute_clusters(&faces, 0.55, |_| {}, || false).unwrap();
        let second = compute_clusters(&faces, 0.55, |_| {}, || false).unwrap();
        assert_eq!(first, second);
        assert_eq!(first, Some(vec![vec![0, 1, 2], vec![3, 4, 5]]));
    }

    #[test]
    fn a_cancelled_clustering_reports_that_it_did_not_finish() {
        let faces = two_groups(3);
        assert_eq!(
            compute_clusters(&faces, 0.55, |_| {}, || true).unwrap(),
            None
        );
    }
}
