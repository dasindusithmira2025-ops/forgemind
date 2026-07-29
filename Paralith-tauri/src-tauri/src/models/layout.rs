use crate::errors::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum LayoutNode {
    Pane {
        #[serde(rename = "paneId")]
        pane_id: String,
    },
    Split {
        direction: SplitDirection,
        sizes: Vec<f64>,
        children: Vec<LayoutNode>,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SplitDirection {
    Horizontal,
    Vertical,
}

impl LayoutNode {
    pub fn validate(&self) -> AppResult<Vec<String>> {
        let mut pane_ids = Vec::new();
        self.collect_and_validate(&mut pane_ids)?;
        let unique: HashSet<_> = pane_ids.iter().collect();
        if unique.len() != pane_ids.len() {
            return Err(AppError::new(
                "invalid_layout",
                "The layout contains duplicate pane IDs.",
                true,
            ));
        }
        if pane_ids.is_empty() {
            return Err(AppError::new(
                "invalid_layout",
                "A workspace must contain at least one pane.",
                true,
            ));
        }
        Ok(pane_ids)
    }

    fn collect_and_validate(&self, pane_ids: &mut Vec<String>) -> AppResult<()> {
        match self {
            Self::Pane { pane_id } => {
                if pane_id.trim().is_empty() {
                    return Err(AppError::new(
                        "invalid_layout",
                        "A pane ID cannot be empty.",
                        true,
                    ));
                }
                pane_ids.push(pane_id.clone());
            }
            Self::Split {
                sizes, children, ..
            } => {
                if children.len() < 2 || sizes.len() != children.len() {
                    return Err(AppError::new(
                        "invalid_layout",
                        "Every split needs matching sizes and at least two children.",
                        true,
                    ));
                }
                if sizes.iter().any(|size| !size.is_finite() || *size <= 0.0) {
                    return Err(AppError::new(
                        "invalid_layout",
                        "Split sizes must be positive finite values.",
                        true,
                    ));
                }
                for child in children {
                    child.collect_and_validate(pane_ids)?;
                }
            }
        }
        Ok(())
    }

    /// Return a copy of this layout with every pane id replaced through `remap`. Ids absent
    /// from the map are kept as-is. Used when duplicating a Workspace so the copy's layout
    /// tree points at the new, independent pane ids.
    pub fn with_remapped_panes(
        &self,
        remap: &std::collections::HashMap<String, String>,
    ) -> LayoutNode {
        match self {
            Self::Pane { pane_id } => Self::Pane {
                pane_id: remap
                    .get(pane_id)
                    .cloned()
                    .unwrap_or_else(|| pane_id.clone()),
            },
            Self::Split {
                direction,
                sizes,
                children,
            } => Self::Split {
                direction: *direction,
                sizes: sizes.clone(),
                children: children
                    .iter()
                    .map(|child| child.with_remapped_panes(remap))
                    .collect(),
            },
        }
    }

    pub fn pane_count(&self) -> usize {
        match self {
            Self::Pane { .. } => 1,
            Self::Split { children, .. } => children.iter().map(Self::pane_count).sum(),
        }
    }

    pub fn split_pane(
        &mut self,
        target: &str,
        direction: SplitDirection,
        new_pane_id: String,
    ) -> bool {
        match self {
            Self::Pane { pane_id } if pane_id == target => {
                let old = pane_id.clone();
                *self = Self::Split {
                    direction,
                    sizes: vec![50.0, 50.0],
                    children: vec![
                        Self::Pane { pane_id: old },
                        Self::Pane {
                            pane_id: new_pane_id,
                        },
                    ],
                };
                true
            }
            Self::Split { children, .. } => children
                .iter_mut()
                .any(|child| child.split_pane(target, direction, new_pane_id.clone())),
            _ => false,
        }
    }

    pub fn remove_pane(self, target: &str) -> AppResult<Self> {
        if self.pane_count() <= 1 {
            return Err(AppError::new(
                "invalid_layout",
                "At least one terminal pane must remain.",
                true,
            ));
        }
        self.remove_inner(target).ok_or_else(|| {
            AppError::new(
                "invalid_layout",
                "The selected pane is not in this layout.",
                true,
            )
        })
    }

    fn remove_inner(self, target: &str) -> Option<Self> {
        match self {
            Self::Pane { pane_id } => (pane_id != target).then_some(Self::Pane { pane_id }),
            Self::Split {
                direction,
                sizes,
                children,
            } => {
                let mut next = Vec::new();
                let mut next_sizes = Vec::new();
                for (index, child) in children.into_iter().enumerate() {
                    if let Some(kept) = child.remove_inner(target) {
                        next.push(kept);
                        next_sizes.push(sizes.get(index).copied().unwrap_or(50.0));
                    }
                }
                match next.len() {
                    0 => None,
                    1 => next.into_iter().next(),
                    _ => {
                        let total: f64 = next_sizes.iter().sum();
                        let normalized = next_sizes
                            .into_iter()
                            .map(|size| size / total * 100.0)
                            .collect();
                        Some(Self::Split {
                            direction,
                            sizes: normalized,
                            children: next,
                        })
                    }
                }
            }
        }
    }
}

pub fn preset_layout(count: usize, variant: &str) -> LayoutNode {
    let pane = || LayoutNode::Pane {
        pane_id: Uuid::new_v4().to_string(),
    };
    match (count, variant) {
        (1, _) => pane(),
        (2, "horizontal") => LayoutNode::Split {
            direction: SplitDirection::Horizontal,
            sizes: vec![50.0, 50.0],
            children: vec![pane(), pane()],
        },
        (2, _) => LayoutNode::Split {
            direction: SplitDirection::Vertical,
            sizes: vec![50.0, 50.0],
            children: vec![pane(), pane()],
        },
        (3, _) => LayoutNode::Split {
            direction: SplitDirection::Vertical,
            sizes: vec![50.0, 50.0],
            children: vec![
                pane(),
                LayoutNode::Split {
                    direction: SplitDirection::Horizontal,
                    sizes: vec![50.0, 50.0],
                    children: vec![pane(), pane()],
                },
            ],
        },
        (4, _) => grid_layout(2, 2, &pane),
        (6, _) => grid_layout(2, 3, &pane),
        (8, _) => grid_layout(2, 4, &pane),
        (10, _) => grid_layout(2, 5, &pane),
        (12, _) => grid_layout(3, 4, &pane),
        (14, _) => grid_layout(2, 7, &pane),
        (16, _) => grid_layout(4, 4, &pane),
        _ => pane(),
    }
}

fn grid_layout(rows: usize, columns: usize, pane: &impl Fn() -> LayoutNode) -> LayoutNode {
    let row_nodes = (0..rows)
        .map(|_| LayoutNode::Split {
            direction: SplitDirection::Vertical,
            sizes: vec![100.0 / columns as f64; columns],
            children: (0..columns).map(|_| pane()).collect(),
        })
        .collect();
    LayoutNode::Split {
        direction: SplitDirection::Horizontal,
        sizes: vec![100.0 / rows as f64; rows],
        children: row_nodes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_preset_is_valid() {
        for (count, variant) in [
            (1, ""),
            (2, "vertical"),
            (2, "horizontal"),
            (3, ""),
            (4, ""),
            (6, ""),
            (8, ""),
            (10, ""),
            (12, ""),
            (14, ""),
            (16, ""),
        ] {
            let layout = preset_layout(count, variant);
            assert_eq!(layout.validate().unwrap().len(), count);
            let roundtrip: LayoutNode =
                serde_json::from_str(&serde_json::to_string(&layout).unwrap()).unwrap();
            assert_eq!(roundtrip.pane_count(), count);
        }
    }

    #[test]
    fn duplicate_panes_are_rejected() {
        let layout = LayoutNode::Split {
            direction: SplitDirection::Vertical,
            sizes: vec![50.0, 50.0],
            children: vec![
                LayoutNode::Pane {
                    pane_id: "same".into(),
                },
                LayoutNode::Pane {
                    pane_id: "same".into(),
                },
            ],
        };
        assert_eq!(layout.validate().unwrap_err().code, "invalid_layout");
    }

    #[test]
    fn split_and_remove_preserve_a_pane() {
        let mut layout = LayoutNode::Pane {
            pane_id: "one".into(),
        };
        assert!(layout.split_pane("one", SplitDirection::Vertical, "two".into()));
        assert_eq!(layout.pane_count(), 2);
        let layout = layout.remove_pane("two").unwrap();
        assert_eq!(layout.pane_count(), 1);
        assert!(layout.remove_pane("one").is_err());
    }
}
